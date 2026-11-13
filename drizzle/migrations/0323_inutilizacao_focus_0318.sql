-- 0318 — Inutilização de números de NF-e pela própria tela fiscal (Focus /v2/nfe/inutilizacao).
-- Caso real: série 3, nº 179–181 (recusa 635 de 12/11/2026) — as maletas já ganharam as notas 197, 213 e 214.
-- O painel da Focus não tem tela de inutilização (só a API, com o token que fica nos segredos), então o Master pede por aqui.
-- Regras:
--  * só faixa PASSADA da série (abaixo do maior número já usado) e sem nenhuma nota registrada nesses números;
--  * no máximo 20 números por pedido; justificativa de 15 a 255 letras;
--  * SEFAZ homologou (102) ou a faixa já estava inutilizada (256/563): as recusas incertas ligadas são marcadas
--    "não foi autorizada" sozinhas (com o protocolo), e o raio-x F11 deixa de listar esses números;
--  * SEFAZ disse "número já utilizado" (241): NADA é marcado — a nota original existe e a nota nova precisa ser cancelada.
CREATE TABLE IF NOT EXISTS public.fiscal_inutilizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente text NOT NULL CHECK (ambiente IN ('homologacao', 'producao')),
  serie text NOT NULL,
  numero_inicial integer NOT NULL CHECK (numero_inicial > 0),
  numero_final integer NOT NULL,
  justificativa text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  resultado text NOT NULL CHECK (resultado IN ('inutilizada', 'ja_inutilizada', 'numero_usado', 'recusada', 'sem_resposta')),
  status text,
  status_sefaz text,
  mensagem_sefaz text,
  protocolo text,
  caminho_xml text,
  resposta jsonb NOT NULL DEFAULT '{}'::jsonb,
  refs text[] NOT NULL DEFAULT '{}',
  pedido_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (numero_final >= numero_inicial AND numero_final - numero_inicial < 20)
);
ALTER TABLE public.fiscal_inutilizacoes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.fiscal_inutilizacoes TO service_role;
COMMENT ON TABLE public.fiscal_inutilizacoes IS '0318: pedidos de inutilização de numeração NF-e feitos pela tela fiscal (resposta da Focus/SEFAZ guardada).';

-- Confere a faixa ANTES de chamar a Focus (servidor). Devolve null se pode, ou o motivo.
CREATE OR REPLACE FUNCTION public.fiscal_inutilizacao_faixa_motivo(_ambiente text, _serie text, _ini integer, _fim integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_max bigint; v_usado text;
BEGIN
  IF _ambiente NOT IN ('homologacao', 'producao') THEN RETURN 'Ambiente inválido.'; END IF;
  IF coalesce(btrim(_serie), '') !~ '^[0-9]{1,3}$' THEN RETURN 'Série inválida.'; END IF;
  IF _ini IS NULL OR _fim IS NULL OR _ini < 1 OR _fim < _ini THEN RETURN 'Faixa inválida.'; END IF;
  IF _fim - _ini >= 20 THEN RETURN 'No máximo 20 números por pedido.'; END IF;
  SELECT max(numero::bigint) INTO v_max FROM fiscal_focus_envios
   WHERE ambiente = _ambiente AND serie IS NOT DISTINCT FROM btrim(_serie) AND numero ~ '^[0-9]+$';
  IF v_max IS NULL OR _fim >= v_max THEN
    RETURN 'Só dá para inutilizar números que ficaram para trás (abaixo da última nota emitida nesta série).';
  END IF;
  SELECT string_agg(numero, ', ' ORDER BY numero::bigint) INTO v_usado FROM fiscal_focus_envios
   WHERE ambiente = _ambiente AND serie IS NOT DISTINCT FROM btrim(_serie) AND numero ~ '^[0-9]+$' AND numero::bigint BETWEEN _ini AND _fim;
  IF v_usado IS NOT NULL THEN RETURN 'Estes números têm nota registrada no Lardan: ' || v_usado || '.'; END IF;
  IF EXISTS (SELECT 1 FROM fiscal_inutilizacoes i WHERE i.ambiente = _ambiente AND i.serie = btrim(_serie) AND i.ok
              AND int4range(i.numero_inicial, i.numero_final, '[]') && int4range(_ini, _fim, '[]')) THEN
    RETURN 'Parte desta faixa já foi inutilizada.';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_inutilizacao_faixa_motivo(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_inutilizacao_faixa_motivo(text, text, integer, integer) TO service_role;

-- Guarda a resposta da Focus e, se a SEFAZ confirmou, dá baixa nas recusas incertas ligadas. Só o servidor chama
-- (depois de conferir no banco, com a sessão do usuário, que ele é quem emite: fiscal_focus_pode('emitir')).
CREATE OR REPLACE FUNCTION public.fiscal_inutilizacao_registrar(_ambiente text, _serie text, _ini integer, _fim integer,
  _justificativa text, _resposta jsonb, _refs text[], _usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_status text := _resposta->>'status';
  v_sefaz text := coalesce(_resposta->>'status_sefaz', '');
  v_msg text := coalesce(_resposta->>'mensagem_sefaz', _resposta->>'mensagem', '');
  v_prot text := _resposta->>'protocolo';
  v_res text; v_ok boolean; v_id uuid; r text; e fiscal_focus_envios; v_marcadas int := 0; v_etapa text;
BEGIN
  IF _usuario IS NULL THEN RAISE EXCEPTION 'Usuário obrigatório.'; END IF;
  v_res := CASE
    WHEN v_status = 'autorizado' OR v_sefaz = '102' THEN 'inutilizada'
    WHEN v_sefaz IN ('256', '563') OR v_msg ~* 'j[aá] (est[aá] )?inutilizad|pedido de inutiliza[cç][aã]o com a mesma faixa' THEN 'ja_inutilizada'
    WHEN v_sefaz = '241' OR v_msg ~* 'n[uú]mero da faixa j[aá] foi utilizado' THEN 'numero_usado'
    WHEN _resposta = '{}'::jsonb OR (v_status IS NULL AND v_sefaz = '') THEN 'sem_resposta'
    ELSE 'recusada' END;
  v_ok := v_res IN ('inutilizada', 'ja_inutilizada');
  INSERT INTO fiscal_inutilizacoes (ambiente, serie, numero_inicial, numero_final, justificativa, ok, resultado, status, status_sefaz,
                                    mensagem_sefaz, protocolo, caminho_xml, resposta, refs, pedido_por)
  VALUES (_ambiente, btrim(_serie), _ini, _fim, btrim(_justificativa), v_ok, v_res, v_status, nullif(v_sefaz, ''), nullif(v_msg, ''),
          v_prot, _resposta->>'caminho_xml', coalesce(_resposta, '{}'::jsonb), coalesce(_refs, '{}'), _usuario)
  RETURNING id INTO v_id;

  IF v_ok THEN
    FOREACH r IN ARRAY coalesce(_refs, '{}') LOOP
      SELECT * INTO e FROM fiscal_focus_envios WHERE ref = r AND ambiente = _ambiente;
      CONTINUE WHEN e.id IS NULL;
      -- só recusa "incerta" (204/539/635) ainda sem conferência
      CONTINUE WHEN NOT (coalesce(e.status, '') IN ('erro_autorizacao', 'erro_envio')
          AND (coalesce(e.status_sefaz, '') IN ('204', '539', '635') OR coalesce(e.mensagem_sefaz, '') ~* '(duplicidade de nf|aguardando processamento|mesmo n[uú]mero e s[eé]rie j[aá] transmitida)'));
      CONTINUE WHEN EXISTS (SELECT 1 FROM fiscal_recusas_conferidas c WHERE c.ref = r);
      INSERT INTO fiscal_recusas_conferidas (ref, resultado, numero_autorizado, observacao, conferido_por)
      VALUES (r, 'nao_autorizada', NULL,
              left('Inutilização na SEFAZ: série ' || btrim(_serie) || ' nº ' || _ini || CASE WHEN _fim > _ini THEN '–' || _fim ELSE '' END
                   || CASE WHEN v_res = 'ja_inutilizada' THEN ' (já estava inutilizada)' ELSE '' END
                   || coalesce(' · protocolo ' || v_prot, '') || ' · ' || btrim(_justificativa), 500),
              _usuario);
      v_marcadas := v_marcadas + 1;
      IF e.cycle_id IS NOT NULL THEN
        v_etapa := CASE WHEN e.operacao = 'remessa' THEN 'remessa' WHEN e.operacao IN ('devolucao', 'venda', 'perda') THEN 'acerto' END;
        UPDATE fiscal_fila SET status = 'pendente', tentativas = 0, proxima_em = now(), atualizado_em = now(),
               erro = left('Conferido: a nota ' || r || ' não foi autorizada (número inutilizado); pode emitir.', 500)
         WHERE cycle_id = e.cycle_id AND etapa = v_etapa AND status = 'erro' AND erro LIKE 'CONFERIR NA FOCUS%';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_usuario, 'fiscal.inutilizacao', 'fiscal_inutilizacoes', v_id::text,
          jsonb_build_object('ambiente', _ambiente, 'serie', btrim(_serie), 'de', _ini, 'ate', _fim, 'resultado', v_res,
                             'status_sefaz', nullif(v_sefaz, ''), 'protocolo', v_prot, 'refs', _refs, 'recusas_baixadas', v_marcadas));
  RETURN jsonb_build_object('id', v_id, 'ok', v_ok, 'resultado', v_res, 'status_sefaz', nullif(v_sefaz, ''),
                            'mensagem', nullif(v_msg, ''), 'protocolo', v_prot, 'recusas_baixadas', v_marcadas);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_inutilizacao_registrar(text, text, integer, integer, text, jsonb, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_inutilizacao_registrar(text, text, integer, integer, text, jsonb, text[], uuid) TO service_role;

-- Histórico para a tela.
CREATE OR REPLACE FUNCTION public.fiscal_inutilizacoes_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.fiscal_focus_pode('ver') OR public.fiscal_focus_pode('emitir')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'ambiente', i.ambiente, 'serie', i.serie, 'de', i.numero_inicial,
                     'ate', i.numero_final, 'ok', i.ok, 'resultado', i.resultado, 'status_sefaz', i.status_sefaz, 'mensagem', i.mensagem_sefaz,
                     'protocolo', i.protocolo, 'quando', i.created_at) ORDER BY i.created_at DESC)
                     FROM (SELECT * FROM fiscal_inutilizacoes ORDER BY created_at DESC LIMIT 50) i), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_inutilizacoes_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_inutilizacoes_lista() TO authenticated;

-- Números pulados (F11) que a tela sugere inutilizar: os da série de produção sem nota registrada e sem inutilização.
CREATE OR REPLACE FUNCTION public.fiscal_numeros_pulados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.fiscal_focus_pode('ver') OR public.fiscal_focus_pode('emitir')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('serie', s.serie, 'numero', g.n) ORDER BY s.serie, g.n)
      FROM (SELECT serie, min(numero::bigint) mn, max(numero::bigint) mx FROM fiscal_focus_envios
             WHERE ambiente = 'producao' AND numero ~ '^[0-9]+$' GROUP BY serie) s
     CROSS JOIN LATERAL generate_series(s.mn, s.mx) g(n)
     WHERE NOT EXISTS (SELECT 1 FROM fiscal_focus_envios x WHERE x.ambiente = 'producao' AND x.serie IS NOT DISTINCT FROM s.serie AND x.numero = g.n::text)
       AND NOT EXISTS (SELECT 1 FROM fiscal_inutilizacoes iu WHERE iu.ambiente = 'producao' AND iu.ok
                        AND iu.serie IS NOT DISTINCT FROM s.serie::text AND g.n BETWEEN iu.numero_inicial AND iu.numero_final)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_numeros_pulados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_numeros_pulados() TO authenticated;

-- Raio-x F11: número inutilizado não é mais "pulado".
DO $do$ DECLARE def text; antes text; BEGIN
  def := pg_get_functiondef('public.auditoria_integridade()'::regprocedure); antes := def;
  IF position('fiscal_inutilizacoes' IN def) > 0 THEN RETURN; END IF;
  def := replace(def,
    $a$x.numero = g.n::text) ORDER BY s.serie, g.n$a$,
    $b$x.numero = g.n::text) AND NOT EXISTS (SELECT 1 FROM fiscal_inutilizacoes iu WHERE iu.ambiente='producao' AND iu.ok AND iu.serie IS NOT DISTINCT FROM s.serie::text AND g.n BETWEEN iu.numero_inicial AND iu.numero_final) ORDER BY s.serie, g.n$b$);
  IF def = antes THEN RAISE EXCEPTION '0318: consulta F11 não encontrada na auditoria; revisar.'; END IF;
  EXECUTE def;
END $do$;

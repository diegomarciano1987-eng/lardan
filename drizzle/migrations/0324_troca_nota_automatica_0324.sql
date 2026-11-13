-- 0324 — Troca/devolução de maleta com nota já autorizada: a parte fiscal é 100% automática (Diego, 13/11/2026).
-- Antes (0274/0279/0280) a troca virava uma pendência que a montagem resolvia no emissor e marcava à mão.
-- Agora, para cada pendência aberta (10 minutos depois do último movimento, para um engano desfeito na hora não gerar nota):
--  * a maleta voltou para quem está na nota                → nada a fazer, a pendência fecha sozinha;
--  * nota com menos de 23 h e a maleta nunca saiu da empresa → a nota antiga é CANCELADA na SEFAZ;
--  * senão                                                 → sai a nota de DEVOLUÇÃO (entrada 1918/2918) de todas as peças
--                                                             daquela nota, em nome de quem está nela, referenciando a remessa;
--  * nota antiga cancelada/devolvida → a remessa antiga fica "anulada" e, se a maleta está com uma consultora,
--    a fila fiscal emite a nota nova de remessa pelo processo normal (0216).
-- Nada é apagado; a nota antiga continua consultável. Marcar "resolvida" à mão deixa de existir.

ALTER TABLE public.fiscal_focus_envios
  ADD COLUMN IF NOT EXISTS troca_pendencia_id uuid REFERENCES public.maleta_troca_pendencias(id),
  ADD COLUMN IF NOT EXISTS anulada_em timestamptz,
  ADD COLUMN IF NOT EXISTS anulada_por_ref text;
COMMENT ON COLUMN public.fiscal_focus_envios.troca_pendencia_id IS '0324: nota de devolução automática da troca/devolução de maleta (não é nota do acerto).';
COMMENT ON COLUMN public.fiscal_focus_envios.anulada_em IS '0324: remessa devolvida por nota de devolução automática (anulada_por_ref); deixa de ser a nota viva da maleta.';

ALTER TABLE public.maleta_troca_pendencias
  ADD COLUMN IF NOT EXISTS nota_ref text,
  ADD COLUMN IF NOT EXISTS auto_status text NOT NULL DEFAULT 'aguardando',
  ADD COLUMN IF NOT EXISTS auto_acao text,
  ADD COLUMN IF NOT EXISTS auto_ref text,
  ADD COLUMN IF NOT EXISTS auto_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_erro text,
  ADD COLUMN IF NOT EXISTS auto_cancelar_falhou boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_proxima_em timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maleta_troca_pendencias_auto_status_check') THEN
    ALTER TABLE public.maleta_troca_pendencias ADD CONSTRAINT maleta_troca_pendencias_auto_status_check
      CHECK (auto_status IN ('aguardando', 'processando', 'feito', 'erro', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maleta_troca_pendencias_auto_acao_check') THEN
    ALTER TABLE public.maleta_troca_pendencias ADD CONSTRAINT maleta_troca_pendencias_auto_acao_check
      CHECK (auto_acao IS NULL OR auto_acao IN ('cancelar', 'devolucao'));
  END IF;
END $do$;
COMMENT ON COLUMN public.maleta_troca_pendencias.auto_status IS '0324: aguardando/processando/feito/erro = parte fiscal automática; manual = resolvida à mão antes do 0324.';

-- Ligação com a nota (backfill) e estado das que já existem.
UPDATE public.maleta_troca_pendencias p SET nota_ref = (
  SELECT e.ref FROM public.fiscal_focus_envios e
   WHERE e.cycle_id = p.cycle_id AND e.operacao = 'remessa' AND e.status IN ('autorizado', 'cancelado')
     AND (e.numero = p.nota_numero OR e.chave_nfe = p.nota_chave)
   ORDER BY e.created_at DESC LIMIT 1)
 WHERE p.nota_ref IS NULL;
UPDATE public.maleta_troca_pendencias SET auto_status = 'aguardando', auto_proxima_em = now() WHERE status = 'aberta' AND auto_acao IS NULL;
UPDATE public.maleta_troca_pendencias
   SET auto_status = CASE WHEN observacao LIKE 'Movimento desfeito%' THEN 'feito' ELSE 'manual' END
 WHERE status = 'resolvida' AND auto_acao IS NULL AND auto_status = 'aguardando';
CREATE INDEX IF NOT EXISTS maleta_troca_pendencias_auto_idx ON public.maleta_troca_pendencias (auto_proxima_em) WHERE status = 'aberta';

-- Remessa viva = não anulada; nota de devolução da troca não conta como nota do acerto. Uma devolução viva por pendência.
DROP INDEX IF EXISTS public.fiscal_focus_envios_remessa_viva_idx;
CREATE UNIQUE INDEX fiscal_focus_envios_remessa_viva_idx ON public.fiscal_focus_envios (cycle_id, ambiente)
  WHERE cycle_id IS NOT NULL AND operacao = 'remessa' AND anulada_em IS NULL
    AND status IN ('pendente', 'processando_autorizacao', 'autorizado');
DROP INDEX IF EXISTS public.fiscal_focus_envios_acerto_viva_idx;
CREATE UNIQUE INDEX fiscal_focus_envios_acerto_viva_idx ON public.fiscal_focus_envios (cycle_id, ambiente, operacao)
  WHERE cycle_id IS NOT NULL AND troca_pendencia_id IS NULL AND operacao IN ('devolucao', 'venda', 'perda')
    AND status IN ('pendente', 'processando_autorizacao', 'autorizado');
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_focus_envios_troca_viva_idx ON public.fiscal_focus_envios (troca_pendencia_id)
  WHERE troca_pendencia_id IS NOT NULL AND status IN ('pendente', 'processando_autorizacao', 'autorizado');

-- Pendência nova: liga à nota; movimento de novo na mesma pendência: espera mais 10 minutos.
CREATE OR REPLACE FUNCTION public.tg_troca_pendencia_auto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.nota_ref IS NULL THEN
      SELECT e.ref INTO NEW.nota_ref FROM fiscal_focus_envios e
       WHERE e.cycle_id = NEW.cycle_id AND e.operacao = 'remessa' AND e.status = 'autorizado' AND e.anulada_em IS NULL
         AND (e.numero = NEW.nota_numero OR e.chave_nfe = NEW.nota_chave)
       ORDER BY e.created_at DESC LIMIT 1;
    END IF;
    NEW.auto_status := CASE WHEN NEW.status = 'aberta' THEN 'aguardando' ELSE 'feito' END;
    NEW.auto_proxima_em := now() + interval '10 minutes';
    RETURN NEW;
  END IF;
  IF NEW.status = 'aberta' AND (NEW.consultora_nova_party_id IS DISTINCT FROM OLD.consultora_nova_party_id
                               OR NEW.consultora_nova_nome IS DISTINCT FROM OLD.consultora_nova_nome
                               OR NEW.origem IS DISTINCT FROM OLD.origem) THEN
    NEW.atualizado_em := now();
    IF NEW.auto_status = 'aguardando' OR (NEW.auto_status = 'erro' AND coalesce(NEW.auto_erro, '') NOT LIKE 'CONFERIR NA FOCUS%') THEN
      NEW.auto_status := 'aguardando'; NEW.auto_proxima_em := now() + interval '10 minutes';
      NEW.auto_tentativas := 0; NEW.auto_erro := NULL;
    END IF;
  END IF;
  IF NEW.status = 'resolvida' AND OLD.status = 'aberta' AND NEW.auto_status <> 'feito' THEN NEW.auto_status := 'feito'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aa_troca_pendencia_auto ON public.maleta_troca_pendencias;
CREATE TRIGGER aa_troca_pendencia_auto BEFORE INSERT OR UPDATE ON public.maleta_troca_pendencias
  FOR EACH ROW EXECUTE FUNCTION public.tg_troca_pendencia_auto();

-- Fecha a pendência e, se a maleta está com uma consultora, põe a nota nova de remessa na fila normal.
CREATE OR REPLACE FUNCTION public.fiscal_troca_concluir(_pendencia uuid, _obs text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p maleta_troca_pendencias; c kit_cycles; s record; v_fila boolean := false;
BEGIN
  SELECT * INTO p FROM maleta_troca_pendencias WHERE id = _pendencia FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'aberta' THEN RETURN jsonb_build_object('repetida', true); END IF;
  UPDATE maleta_troca_pendencias SET status = 'resolvida', resolvido_em = now(), resolvido_por = NULL,
         auto_status = 'feito', auto_erro = NULL,
         observacao = left(concat_ws(' · ', observacao, 'Automático: ' || _obs), 1000)
   WHERE id = p.id;
  SELECT * INTO c FROM kit_cycles WHERE id = p.cycle_id;
  SELECT * INTO s FROM fiscal_settings WHERE id;
  IF c.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') AND c.consultora_party_id IS NOT NULL
     AND public.fiscal_focus_producao_ativa() AND s.producao_automatico AND (s.producao_todas OR s.producao_piloto_cycle_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.ambiente = 'producao'
                      AND e.anulada_em IS NULL AND (e.status IN ('pendente', 'processando_autorizacao', 'autorizado')
                           OR public.fiscal_recusa_incerta(e.status, e.status_sefaz, e.mensagem_sefaz, e.ref))) THEN
    INSERT INTO fiscal_fila (cycle_id, etapa) VALUES (c.id, 'remessa')
      ON CONFLICT (cycle_id, etapa) DO UPDATE SET status = 'pendente', tentativas = 0, erro = NULL, proxima_em = now(), atualizado_em = now();
    v_fila := true;
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'fiscal.troca_automatica', 'kit_cycles', p.cycle_id::text,
          jsonb_build_object('pendencia', p.id, 'maleta', p.maleta, 'nota_antiga', p.nota_numero, 'acao', p.auto_acao,
                             'nota_devolucao', p.auto_ref, 'nota_nova_na_fila', v_fila, 'obs', _obs));
  RETURN jsonb_build_object('ok', true, 'nota_nova_na_fila', v_fila);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_troca_concluir(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_troca_concluir(uuid, text) TO service_role;

-- Tentativa que não deu certo: tenta de novo mais tarde (5 vezes); cancelamento recusado passa para a devolução.
CREATE OR REPLACE FUNCTION public.fiscal_troca_falhou(_pendencia uuid, _erro text, _cancelar_falhou boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE maleta_troca_pendencias SET
    auto_status = CASE WHEN auto_tentativas >= 5 THEN 'erro' ELSE 'aguardando' END,
    auto_erro = left(_erro, 500),
    auto_cancelar_falhou = auto_cancelar_falhou OR coalesce(_cancelar_falhou, false),
    auto_proxima_em = now() + make_interval(mins => least(60, 2 ^ greatest(auto_tentativas, 1))::int)
   WHERE id = _pendencia AND status = 'aberta';
END $$;
REVOKE ALL ON FUNCTION public.fiscal_troca_falhou(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_troca_falhou(uuid, text, boolean) TO service_role;

-- Fila das trocas (servidor, a cada minuto): resolve no banco o que não precisa de nota e devolve o plano do resto.
CREATE OR REPLACE FUNCTION public.fiscal_trocas_proximas(_limite integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p maleta_troca_pendencias; c kit_cycles; e fiscal_focus_envios; s record; out jsonb := '[]'::jsonb;
        v_acao text; base jsonb; itens jsonb; n int := 0;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO s FROM fiscal_settings WHERE id;
  FOR p IN SELECT * FROM maleta_troca_pendencias
            WHERE status = 'aberta' AND auto_status IN ('aguardando', 'processando') AND auto_proxima_em <= now()
            ORDER BY auto_proxima_em FOR UPDATE SKIP LOCKED LOOP
    EXIT WHEN n >= least(greatest(coalesce(_limite, 5), 1), 20);
    SELECT * INTO c FROM kit_cycles WHERE id = p.cycle_id;
    e := NULL;
    IF p.nota_ref IS NOT NULL THEN SELECT * INTO e FROM fiscal_focus_envios WHERE ref = p.nota_ref; END IF;
    IF e.id IS NULL THEN
      UPDATE maleta_troca_pendencias SET auto_status = 'erro', auto_proxima_em = now() + interval '1 day',
             auto_erro = 'A nota desta maleta não foi emitida pelo Lardan: a devolução dela precisa ser feita no emissor onde saiu.'
       WHERE id = p.id;
      CONTINUE;
    END IF;
    IF e.ambiente <> 'producao' THEN
      PERFORM public.fiscal_troca_concluir(p.id, 'a nota ' || coalesce(e.numero, e.ref) || ' era de teste (sem valor fiscal); nada a devolver.');
      CONTINUE;
    END IF;
    IF e.status = 'cancelado' OR e.anulada_em IS NOT NULL THEN
      PERFORM public.fiscal_troca_concluir(p.id, 'a nota nº ' || coalesce(e.numero, '?') || ' já estava cancelada ou devolvida.');
      CONTINUE;
    END IF;
    IF c.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') AND c.consultora_party_id = e.party_id THEN
      PERFORM public.fiscal_troca_concluir(p.id, 'a maleta voltou para quem está na nota nº ' || coalesce(e.numero, '?') || '; nada a fazer.');
      CONTINUE;
    END IF;
    IF e.status <> 'autorizado' THEN
      UPDATE maleta_troca_pendencias SET auto_status = 'erro', auto_proxima_em = now() + interval '1 day',
             auto_erro = 'A nota nº ' || coalesce(e.numero, e.ref) || ' está ' || e.status || ' na SEFAZ; conferir na Focus.' WHERE id = p.id;
      CONTINUE;
    END IF;
    IF NOT (public.fiscal_focus_producao_ativa() AND s.producao_automatico AND (s.producao_todas OR s.producao_piloto_cycle_id = p.cycle_id)) THEN
      UPDATE maleta_troca_pendencias SET auto_proxima_em = now() + interval '30 minutes' WHERE id = p.id;  -- emissão automática desligada: espera
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM fiscal_focus_envios d WHERE d.troca_pendencia_id = p.id
                AND (d.status IN ('pendente', 'processando_autorizacao', 'autorizado')
                     OR public.fiscal_recusa_incerta(d.status, d.status_sefaz, d.mensagem_sefaz, d.ref))) THEN
      UPDATE maleta_troca_pendencias SET auto_status = 'processando', auto_proxima_em = now() + interval '10 minutes' WHERE id = p.id;
      CONTINUE;  -- nota de devolução já está na SEFAZ: o retorno dela fecha a pendência
    END IF;

    -- cancelar só quando a nota tem menos de 23 h e a maleta nunca saiu da empresa (mercadoria não circulou)
    v_acao := CASE WHEN NOT p.auto_cancelar_falhou AND e.created_at > now() - interval '23 hours' AND c.status::text = 'conferida'
                        AND NOT EXISTS (SELECT 1 FROM kit_events k WHERE k.cycle_id = c.id
                                         AND k.to_status::text IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto', 'encerrada'))
                        AND NOT EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id)
                   THEN 'cancelar' ELSE 'devolucao' END;
    UPDATE maleta_troca_pendencias SET auto_status = 'processando', auto_acao = v_acao, auto_tentativas = auto_tentativas + 1,
           auto_proxima_em = now() + interval '10 minutes' WHERE id = p.id;
    n := n + 1;
    IF v_acao = 'cancelar' THEN
      out := out || jsonb_build_array(jsonb_build_object('pendencia', p.id, 'acao', 'cancelar', 'ambiente', e.ambiente, 'ref', e.ref,
               'numero', e.numero, 'maleta', p.maleta,
               'justificativa', 'Remessa sem efeito: a maleta mudou de consultora antes de sair da empresa; nova nota emitida para quem ficou com ela.'));
    ELSE
      SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', i->>'codigo_produto', 'descricao', i->>'descricao', 'ncm', i->>'codigo_ncm',
                    'quantidade', (i->>'quantidade_comercial')::numeric::int,
                    'preco_varejo_cents', round((i->>'valor_unitario_comercial')::numeric * 100)::int * 3,
                    'numero_item_origem', n_item::int) ORDER BY n_item), '[]'::jsonb)
        INTO itens FROM jsonb_array_elements(e.payload->'items') WITH ORDINALITY AS t(i, n_item);
      base := public.fiscal_focus_dados(e.party_id, '[]'::jsonb);
      out := out || jsonb_build_array(jsonb_build_object('pendencia', p.id, 'acao', 'devolucao', 'ambiente', e.ambiente, 'ref', e.ref,
               'numero', e.numero, 'maleta', p.maleta, 'cancelar_falhou', p.auto_cancelar_falhou,
               'destinatario', base->'destinatario', 'pendencias', base->'pendencias', 'itens', itens,
               'origem', jsonb_build_object('chave', e.chave_nfe, 'numero', e.numero,
                                            'data', to_char(e.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')),
               'texto', e.payload->>'informacoes_adicionais_contribuinte'));
    END IF;
  END LOOP;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.fiscal_trocas_proximas(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_trocas_proximas(integer) TO service_role;

-- Registra a nota de devolução da troca antes de mandar à Focus (servidor).
CREATE OR REPLACE FUNCTION public.fiscal_troca_registrar(_pendencia uuid, _ref text, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p maleta_troca_pendencias; e fiscal_focus_envios;
BEGIN
  PERFORM public.fiscal_focus_exigir_servidor();
  SELECT * INTO p FROM maleta_troca_pendencias WHERE id = _pendencia FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'aberta' THEN RAISE EXCEPTION 'Pendência de troca já fechada.'; END IF;
  SELECT * INTO e FROM fiscal_focus_envios WHERE ref = p.nota_ref FOR UPDATE;
  IF e.id IS NULL OR e.operacao <> 'remessa' OR e.status <> 'autorizado' OR e.anulada_em IS NOT NULL OR e.chave_nfe IS NULL THEN
    RAISE EXCEPTION 'A nota de remessa desta troca não está mais autorizada.';
  END IF;
  IF EXISTS (SELECT 1 FROM fiscal_focus_envios d WHERE d.troca_pendencia_id = p.id
              AND (d.status IN ('pendente', 'processando_autorizacao', 'autorizado')
                   OR public.fiscal_recusa_incerta(d.status, d.status_sefaz, d.mensagem_sefaz, d.ref))) THEN
    RAISE EXCEPTION 'Esta troca já tem nota de devolução.';
  END IF;
  INSERT INTO fiscal_focus_envios (ref, ambiente, operacao, teste, ref_origem, party_id, payload, criado_por, cycle_id, troca_pendencia_id)
  VALUES (_ref, e.ambiente, 'devolucao', e.ambiente = 'homologacao', e.ref, e.party_id, _payload, NULL, p.cycle_id, p.id);
  UPDATE maleta_troca_pendencias SET auto_ref = _ref, auto_acao = 'devolucao' WHERE id = p.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'fiscal.focus_envio', 'fiscal_focus_envios', _ref,
          jsonb_build_object('ambiente', e.ambiente, 'operacao', 'devolucao', 'cycle_id', p.cycle_id, 'ref_origem', e.ref,
                             'troca_pendencia', p.id, 'motivo', 'troca/devolução de maleta'));
  RETURN jsonb_build_object('ref', _ref);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_troca_registrar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_troca_registrar(uuid, text, jsonb) TO service_role;

-- Retorno da SEFAZ: devolução autorizada anula a remessa; remessa cancelada fecha a troca; recusa volta para a fila das trocas.
CREATE OR REPLACE FUNCTION public.fiscal_troca_envio_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o fiscal_focus_envios; pid uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.troca_pendencia_id IS NOT NULL THEN
    IF NEW.status = 'autorizado' THEN
      UPDATE fiscal_focus_envios SET anulada_em = now(), anulada_por_ref = NEW.ref WHERE ref = NEW.ref_origem AND anulada_em IS NULL
      RETURNING * INTO o;
      PERFORM public.fiscal_troca_concluir(NEW.troca_pendencia_id,
        'nota de devolução nº ' || coalesce(NEW.numero, '?') || ' autorizada (devolve a remessa nº ' || coalesce(o.numero, '?') || ').');
    ELSIF NEW.status IN ('erro_autorizacao', 'erro_envio', 'denegado') AND OLD.status IN ('pendente', 'processando_autorizacao') THEN
      IF public.fiscal_recusa_incerta(NEW.status, NEW.status_sefaz, NEW.mensagem_sefaz, NEW.ref) THEN
        UPDATE maleta_troca_pendencias SET auto_status = 'erro', auto_proxima_em = now() + interval '1 day',
               auto_erro = left('CONFERIR NA FOCUS antes de emitir outra: a SEFAZ respondeu ' || coalesce(NEW.status_sefaz, '') || ' ('
                                || coalesce(NEW.mensagem_sefaz, '') || ') para a nota ' || NEW.ref || '.', 500)
         WHERE id = NEW.troca_pendencia_id AND status = 'aberta';
      ELSE
        PERFORM public.fiscal_troca_falhou(NEW.troca_pendencia_id,
          'SEFAZ recusou a nota de devolução: ' || coalesce(NEW.mensagem_sefaz, NEW.status), false);
      END IF;
    END IF;
  ELSIF NEW.operacao = 'remessa' AND NEW.status = 'cancelado' AND OLD.status = 'autorizado' THEN
    FOR pid IN SELECT id FROM maleta_troca_pendencias WHERE nota_ref = NEW.ref AND status = 'aberta' LOOP
      PERFORM public.fiscal_troca_concluir(pid, 'nota nº ' || coalesce(NEW.numero, '?') || ' cancelada na SEFAZ.');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_fiscal_troca_envio ON public.fiscal_focus_envios;
CREATE TRIGGER zz_fiscal_troca_envio AFTER UPDATE OF status ON public.fiscal_focus_envios
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_troca_envio_trg();

-- Ninguém mais marca à mão.
CREATE OR REPLACE FUNCTION public.maleta_troca_pendencia_resolver(_id uuid, _obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'A nota da maleta trocada agora sai sozinha: o sistema devolve ou cancela a nota antiga e emite a nova. Não precisa marcar nada.';
END $$;
REVOKE ALL ON FUNCTION public.maleta_troca_pendencia_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maleta_troca_pendencia_resolver(uuid, text) TO authenticated, service_role;

-- Fila fiscal: devolução desfeita (cancelada → maleta de novo na rua) pede nota nova se a antiga já foi devolvida.
CREATE OR REPLACE FUNCTION public.fiscal_fila_kit_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s record; v_etapa text; v_reabrir boolean := false;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_etapa := CASE NEW.status::text WHEN 'conferida' THEN 'remessa' WHEN 'encerrada' THEN 'acerto' END;
    IF v_etapa IS NULL AND OLD.status::text = 'cancelada' AND NEW.status::text IN ('expedida', 'transito', 'recebida', 'operacao') THEN
      v_etapa := 'remessa'; v_reabrir := true;
    END IF;
  ELSIF OLD.consultora_party_id IS NULL AND NEW.consultora_party_id IS NOT NULL
        AND NEW.status::text IN ('conferida', 'expedida', 'transito', 'recebida', 'operacao') THEN
    v_etapa := 'remessa';
  END IF;
  IF v_etapa IS NULL OR NEW.consultora_party_id IS NULL THEN RETURN NEW; END IF;
  IF v_etapa = 'remessa' AND EXISTS (SELECT 1 FROM maleta_troca_pendencias p WHERE p.cycle_id = NEW.id AND p.status = 'aberta') THEN
    RETURN NEW; -- 0282/0324: a troca automática termina primeiro e ela mesma pede a nota nova
  END IF;
  SELECT * INTO s FROM fiscal_settings WHERE id;
  IF NOT (public.fiscal_focus_producao_ativa() AND s.producao_automatico AND (s.producao_todas OR s.producao_piloto_cycle_id = NEW.id)) THEN
    RETURN NEW;
  END IF;
  IF v_etapa = 'acerto' AND NOT EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = NEW.id AND e.operacao = 'remessa'
                                       AND e.ambiente = 'producao' AND e.status = 'autorizado' AND e.anulada_em IS NULL) THEN
    RETURN NEW;
  END IF;
  IF v_reabrir AND EXISTS (SELECT 1 FROM fiscal_focus_envios e WHERE e.cycle_id = NEW.id AND e.operacao = 'remessa' AND e.ambiente = 'producao'
                            AND e.anulada_em IS NULL AND e.status IN ('pendente', 'processando_autorizacao', 'autorizado')) THEN
    RETURN NEW; -- a nota antiga continua valendo
  END IF;
  INSERT INTO fiscal_fila (cycle_id, etapa) VALUES (NEW.id, v_etapa)
   ON CONFLICT (cycle_id, etapa) DO UPDATE SET status = 'pendente', proxima_em = now(), atualizado_em = now(),
          tentativas = CASE WHEN v_reabrir THEN 0 ELSE fiscal_fila.tentativas END
   WHERE fiscal_fila.status = 'erro' OR (v_reabrir AND fiscal_fila.status = 'feito');
  RETURN NEW;
END $function$;

-- Nota da maleta na tela: a remessa viva (não anulada) e, se a antiga foi devolvida, a nota de devolução dela.
CREATE OR REPLACE FUNCTION public.fiscal_focus_notas_maletas(_cycles uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT (public.fiscal_focus_pode('ver') OR public.can_manage_kits(auth.uid())) THEN RETURN '[]'::jsonb; END IF;
  IF coalesce(array_length(_cycles, 1), 0) > 500 THEN RAISE EXCEPTION 'Informe até 500 maletas.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'cycle_id', e.cycle_id, 'ref', e.ref, 'ambiente', e.ambiente, 'status', e.status,
      'status_sefaz', e.status_sefaz, 'mensagem_sefaz', e.mensagem_sefaz, 'erros', e.erros,
      'numero', e.numero, 'serie', e.serie, 'tem_danfe', e.caminho_xml IS NOT NULL OR e.caminho_danfe IS NOT NULL,
      'desatualizada', e.composicao_versao IS DISTINCT FROM (SELECT max(version) FROM kit_compositions c WHERE c.cycle_id = e.cycle_id),
      'created_at', e.created_at,
      'anulada', e.anulada_em IS NOT NULL,
      'devolucao_troca', (SELECT jsonb_build_object('ref', d.ref, 'status', d.status, 'numero', d.numero,
                                 'tem_danfe', d.caminho_xml IS NOT NULL OR d.caminho_danfe IS NOT NULL)
                            FROM fiscal_focus_envios d WHERE d.ref = e.anulada_por_ref),
      'acerto', coalesce((SELECT jsonb_agg(jsonb_build_object('operacao', a.operacao, 'ref', a.ref, 'status', a.status, 'numero', a.numero,
                                   'mensagem_sefaz', a.mensagem_sefaz, 'erros', a.erros, 'tem_danfe', a.caminho_xml IS NOT NULL OR a.caminho_danfe IS NOT NULL)
                                   ORDER BY a.operacao)
                  FROM (SELECT DISTINCT ON (operacao) * FROM fiscal_focus_envios x
                         WHERE x.cycle_id = e.cycle_id AND x.operacao IN ('devolucao', 'venda', 'perda') AND x.ambiente = e.ambiente
                           AND x.troca_pendencia_id IS NULL
                         ORDER BY operacao, created_at DESC) a), '[]'::jsonb)))
    FROM (SELECT DISTINCT ON (cycle_id) * FROM fiscal_focus_envios
           WHERE cycle_id = ANY(_cycles) AND operacao = 'remessa'
           ORDER BY cycle_id, (anulada_em IS NOT NULL), created_at DESC) e), '[]'::jsonb);
END $function$;

-- Lista para a tela fiscal (somente leitura).
CREATE OR REPLACE FUNCTION public.fiscal_trocas_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.fiscal_focus_pode('ver') OR public.fiscal_focus_pode('emitir')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'cycle_id', p.cycle_id, 'maleta', p.maleta, 'status', p.status,
             'origem', p.origem, 'anterior', p.consultora_anterior_nome, 'nova', p.consultora_nova_nome, 'nota_numero', p.nota_numero,
             'auto_status', p.auto_status, 'auto_acao', p.auto_acao, 'auto_erro', p.auto_erro, 'proxima_em', p.auto_proxima_em,
             'resolvido_em', p.resolvido_em, 'observacao', p.observacao,
             'devolucao', (SELECT jsonb_build_object('ref', d.ref, 'status', d.status, 'numero', d.numero) FROM fiscal_focus_envios d WHERE d.ref = p.auto_ref),
             'nova_remessa', (SELECT jsonb_build_object('ref', r.ref, 'status', r.status, 'numero', r.numero) FROM fiscal_focus_envios r
                               WHERE r.cycle_id = p.cycle_id AND r.operacao = 'remessa' AND r.anulada_em IS NULL AND r.ambiente = 'producao'
                                 AND r.ref IS DISTINCT FROM p.nota_ref AND r.created_at > p.criado_em ORDER BY r.created_at DESC LIMIT 1))
             ORDER BY (p.status = 'aberta') DESC, coalesce(p.resolvido_em, p.criado_em) DESC)
    FROM (SELECT * FROM maleta_troca_pendencias
           WHERE status = 'aberta' OR (auto_status = 'feito' AND resolvido_em > now() - interval '30 days')
           ORDER BY criado_em DESC LIMIT 100) p), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.fiscal_trocas_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_trocas_lista() TO authenticated;

-- Remessa anulada não conta como nota viva; devolução da troca não conta como nota do acerto.
DO $do$
DECLARE def text; antes text; f text; pares text[][]; i int;
BEGIN
  FOR f, pares IN SELECT * FROM (VALUES
    ('public.fiscal_focus_maleta_dados(uuid)', ARRAY[ARRAY[
      $a$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND (status IN$a$,
      $b$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND anulada_em IS NULL AND (status IN$b$]]),
    ('public.fiscal_focus_envio_maleta_registrar(text, text, uuid, uuid, integer, jsonb, uuid, uuid[])', ARRAY[ARRAY[
      $a$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = _ambiente AND (status IN$a$,
      $b$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = _ambiente AND anulada_em IS NULL AND (status IN$b$]]),
    ('public.fiscal_focus_acerto_dados(uuid)', ARRAY[ARRAY[
      $a$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND status = 'autorizado'$a$,
      $b$WHERE cycle_id = _cycle AND operacao = 'remessa' AND ambiente = amb AND status = 'autorizado' AND anulada_em IS NULL$b$], ARRAY[
      $a$WHERE cycle_id = _cycle AND operacao = op AND ambiente = amb AND (status IN$a$,
      $b$WHERE cycle_id = _cycle AND operacao = op AND ambiente = amb AND troca_pendencia_id IS NULL AND (status IN$b$]]),
    ('public.fiscal_focus_envio_acerto_registrar(text, text, uuid, text, text, uuid, jsonb, uuid)', ARRAY[ARRAY[
      $a$OR o.ambiente <> _ambiente THEN$a$,
      $b$OR o.ambiente <> _ambiente OR o.anulada_em IS NOT NULL THEN$b$], ARRAY[
      $a$WHERE cycle_id = _cycle AND operacao = _operacao AND ambiente = _ambiente AND (status IN$a$,
      $b$WHERE cycle_id = _cycle AND operacao = _operacao AND ambiente = _ambiente AND troca_pendencia_id IS NULL AND (status IN$b$]]),
    ('public.maleta_transferir_exec(uuid, uuid, uuid, boolean, text, uuid, text)', ARRAY[ARRAY[
      $a$WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado'$a$,
      $b$WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado' AND e.anulada_em IS NULL$b$]]),
    ('public.maleta_devolucao_receber(uuid)', ARRAY[ARRAY[
      $a$WHERE cycle_id = c.id AND operacao = 'remessa' AND status = 'autorizado'$a$,
      $b$WHERE cycle_id = c.id AND operacao = 'remessa' AND status = 'autorizado' AND anulada_em IS NULL$b$], ARRAY[
      $a$'Maleta devolvida à empresa: fazer a nota de devolução. '$a$,
      $b$'Maleta devolvida à empresa (a nota de devolução sai sozinha). '$b$]]),
    ('public.fiscal_recusa_reabre_fila_trg()', ARRAY[ARRAY[
      $a$IF NEW.ambiente <> 'producao' OR NEW.cycle_id IS NULL THEN RETURN NEW; END IF;$a$,
      $b$IF NEW.ambiente <> 'producao' OR NEW.cycle_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.troca_pendencia_id IS NOT NULL THEN RETURN NEW; END IF; -- 0324: a troca automática cuida da própria recusa$b$], ARRAY[
      $a$WHERE o.cycle_id = NEW.cycle_id AND o.ambiente = NEW.ambiente$a$,
      $b$WHERE o.cycle_id = NEW.cycle_id AND o.ambiente = NEW.ambiente AND o.troca_pendencia_id IS NULL AND o.anulada_em IS NULL$b$]]),
    ('public.fiscal_recusa_conferir(text, text, text, text)', ARRAY[ARRAY[
      $a$GET DIAGNOSTICS v_reaberta = ROW_COUNT;$a$,
      $b$GET DIAGNOSTICS v_reaberta = ROW_COUNT;
    IF e.troca_pendencia_id IS NOT NULL THEN  -- 0324: devolução da troca conferida como não autorizada: a troca tenta de novo
      UPDATE maleta_troca_pendencias SET auto_status = 'aguardando', auto_erro = NULL, auto_proxima_em = now()
       WHERE id = e.troca_pendencia_id AND status = 'aberta' AND auto_status = 'erro';
    END IF;$b$]])
  ) v(f, pares) LOOP
    def := pg_get_functiondef(f::regprocedure); antes := def;
    IF position('anulada_em' IN def) > 0 OR position('troca_pendencia_id' IN def) > 0 THEN CONTINUE; END IF;
    FOR i IN 1 .. array_length(pares, 1) LOOP
      IF position(pares[i][1] IN def) = 0 THEN RAISE EXCEPTION '0324: trecho não encontrado em %: %', f, pares[i][1]; END IF;
      def := replace(def, pares[i][1], pares[i][2]);
    END LOOP;
    EXECUTE def;
  END LOOP;
END $do$;

DO $do$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.maleta_transferir_situacao'::regproc);
  IF position('anulada_em' IN def) > 0 THEN RETURN; END IF;
  IF position($a$WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado'$a$ IN def) = 0 THEN
    RAISE EXCEPTION '0324: trecho não encontrado em maleta_transferir_situacao';
  END IF;
  EXECUTE replace(def, $a$WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado'$a$,
                       $b$WHERE e.cycle_id = c.id AND e.operacao = 'remessa' AND e.status = 'autorizado' AND e.anulada_em IS NULL$b$);
END $do$;
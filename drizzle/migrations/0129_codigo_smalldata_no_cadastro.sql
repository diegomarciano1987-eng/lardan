-- 0129 — Consultora antiga usa o número do SmallData como código do cadastro.
--
-- Ex.: Carla Vicente Ferreira é 8705 no SmallData e LC-003109 no Lardan. Com esta mudança o
-- código dela passa a ser 8705. Consultora nova continua com o código gerado pelo Lardan (LC-…).
--
-- Por que não quebra nada
--   • Nada liga por código: títulos, cobranças, Asaas, maletas, login e histórico usam o id do
--     cadastro. O Asaas casa fatura antiga por party_codigos_legados, que não muda.
--   • O código antigo (LC-…) fica guardado em party_codigo_historico e continua achando a pessoa
--     na busca de cadastros.
--   • Números do SmallData não colidem com os do Lardan (LC-000000 tem outro formato).
--   • Só muda quem tem UM código do SmallData (ou um só ativo); quem tem mais de um fica para o
--     Master escolher. Representante não muda (o código dele é o endereço da página pública).
-- Nada é apagado; nenhuma coluna removida.

CREATE TABLE IF NOT EXISTS public.party_codigo_historico (
  id bigserial PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES public.parties(id),
  code_antigo text NOT NULL,
  code_novo text NOT NULL,
  motivo text NOT NULL,
  autor uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS party_codigo_historico_party_idx ON public.party_codigo_historico (party_id);
CREATE INDEX IF NOT EXISTS party_codigo_historico_antigo_idx ON public.party_codigo_historico (upper(code_antigo));
ALTER TABLE public.party_codigo_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.party_codigo_historico FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.party_codigo_historico TO service_role;

-- Códigos do SmallData de cada cadastro (das duas ligações que já existem)
CREATE OR REPLACE FUNCTION public.party_codigos_smalldata(_party uuid)
RETURNS TABLE (codigo text, ativo boolean) LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT x.codigo, bool_or(coalesce(lc.ativo, true)) ativo
    FROM (SELECT l.codigo FROM party_codigos_legados l WHERE l.party_id = _party AND l.sistema = 'cliente' AND l.codigo ~ '^\d+$'
          UNION
          SELECT lc.codcli::text FROM legado_consultoras lc WHERE lc.party_id = _party) x
    LEFT JOIN legado_consultoras lc ON lc.codcli::text = x.codigo
   GROUP BY x.codigo
$fn$;
REVOKE ALL ON FUNCTION public.party_codigos_smalldata(uuid) FROM PUBLIC, anon, authenticated;

-- Um cadastro: adota o código do SmallData (o informado, ou o único/único ativo)
CREATE OR REPLACE FUNCTION public.party_codigo_smalldata_adotar(_party uuid, _codigo text DEFAULT NULL, _motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p parties; cods text[]; ativos text[]; escolhido text; uid uuid := auth.uid();
BEGIN
  IF uid IS NOT NULL AND NOT (public.has_role(uid, 'master') AND public.has_capability(uid, 'registry.manage')) THEN
    RAISE EXCEPTION 'Só o Master troca o código do cadastro.' USING errcode = '42501';
  END IF;
  SELECT * INTO p FROM parties WHERE id = _party FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM party_roles r WHERE r.party_id = p.id AND r.role = 'representante' AND r.ended_at IS NULL) THEN
    RAISE EXCEPTION 'Representante mantém o código: ele é o endereço da página pública.';
  END IF;
  SELECT array_agg(codigo ORDER BY codigo::bigint), array_agg(codigo ORDER BY codigo::bigint) FILTER (WHERE ativo)
    INTO cods, ativos FROM public.party_codigos_smalldata(p.id);
  IF cods IS NULL THEN RAISE EXCEPTION 'Este cadastro não está ligado a nenhum código do SmallData.'; END IF;
  escolhido := btrim(coalesce(_codigo, ''));
  IF escolhido = '' THEN
    escolhido := CASE WHEN array_length(cods, 1) = 1 THEN cods[1] WHEN array_length(ativos, 1) = 1 THEN ativos[1] END;
    IF escolhido IS NULL THEN
      RAISE EXCEPTION 'Este cadastro tem mais de um código do SmallData (%): informe qual usar.', array_to_string(cods, ', ');
    END IF;
  ELSIF NOT escolhido = ANY (cods) THEN
    RAISE EXCEPTION 'O código % não é deste cadastro no SmallData (códigos dele: %).', escolhido, array_to_string(cods, ', ');
  END IF;
  IF p.code = escolhido THEN RETURN jsonb_build_object('party_id', p.id, 'code', p.code, 'repetido', true); END IF;
  IF EXISTS (SELECT 1 FROM parties o WHERE upper(o.code) = upper(escolhido) AND o.id <> p.id) THEN
    RAISE EXCEPTION 'O código % já é de outro cadastro.', escolhido;
  END IF;

  INSERT INTO party_codigo_historico (party_id, code_antigo, code_novo, motivo, autor)
  VALUES (p.id, p.code, escolhido, coalesce(nullif(btrim(_motivo), ''), 'código do SmallData'), uid);
  UPDATE parties SET code = escolhido, updated_at = now() WHERE id = p.id;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'cadastro.codigo_smalldata', 'parties', p.id::text, jsonb_build_object('antes', p.code, 'depois', escolhido));
  RETURN jsonb_build_object('party_id', p.id, 'antes', p.code, 'code', escolhido);
END $fn$;
REVOKE ALL ON FUNCTION public.party_codigo_smalldata_adotar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_codigo_smalldata_adotar(uuid, text, text) TO authenticated, service_role;

-- Todos de uma vez: prévia por padrão; com _aplicar, troca quem tem um código só (ou um só ativo)
CREATE OR REPLACE FUNCTION public.party_codigos_smalldata_adotar(_aplicar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); r record; feitos int := 0; falhas jsonb := '[]';
BEGIN
  IF uid IS NOT NULL AND NOT (public.has_role(uid, 'master') AND public.has_capability(uid, 'registry.manage')) THEN
    RAISE EXCEPTION 'Só o Master troca o código do cadastro.' USING errcode = '42501';
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS _cs (party_id uuid PRIMARY KEY, nome text, code text, codigos text[], ativos text[], sugerido text,
    representante boolean, ocupado boolean) ON COMMIT DROP;
  TRUNCATE _cs;
  INSERT INTO _cs (party_id, nome, code, codigos, ativos, representante)
  SELECT p.id, p.display_name, p.code,
         (SELECT array_agg(codigo ORDER BY codigo::bigint) FROM public.party_codigos_smalldata(p.id)),
         (SELECT array_agg(codigo ORDER BY codigo::bigint) FILTER (WHERE ativo) FROM public.party_codigos_smalldata(p.id)),
         EXISTS (SELECT 1 FROM party_roles pr WHERE pr.party_id = p.id AND pr.role = 'representante' AND pr.ended_at IS NULL)
    FROM parties p
   WHERE EXISTS (SELECT 1 FROM party_codigos_legados l WHERE l.party_id = p.id AND l.sistema = 'cliente' AND l.codigo ~ '^\d+$')
      OR EXISTS (SELECT 1 FROM legado_consultoras lc WHERE lc.party_id = p.id);
  UPDATE _cs SET sugerido = CASE WHEN array_length(codigos, 1) = 1 THEN codigos[1] WHEN array_length(ativos, 1) = 1 THEN ativos[1] END;
  UPDATE _cs c SET ocupado = EXISTS (SELECT 1 FROM parties o WHERE upper(o.code) = upper(c.sugerido) AND o.id <> c.party_id);

  IF _aplicar THEN
    FOR r IN SELECT * FROM _cs WHERE sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido AND NOT representante AND NOT ocupado LOOP
      BEGIN
        PERFORM public.party_codigo_smalldata_adotar(r.party_id, r.sugerido, 'código do SmallData (lote)');
        feitos := feitos + 1;
      EXCEPTION WHEN OTHERS THEN
        falhas := falhas || jsonb_build_object('cadastro', r.code, 'nome', r.nome, 'erro', SQLERRM);
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'aplicado', _aplicar,
    'ligados_ao_smalldata', (SELECT count(*) FROM _cs),
    'ja_com_codigo_smalldata', (SELECT count(*) FROM _cs WHERE code = sugerido OR code = ANY (codigos)),
    'a_trocar', (SELECT count(*) FROM _cs WHERE sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido AND NOT (code = ANY (codigos))
                   AND NOT representante AND NOT ocupado),
    'trocados', feitos,
    'mais_de_um_codigo', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigos', codigos) ORDER BY nome), '[]')
                            FROM _cs WHERE sugerido IS NULL),
    'representantes_mantidos', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigos', codigos) ORDER BY nome), '[]')
                                  FROM _cs WHERE representante AND sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido),
    'codigo_ja_usado_por_outro', (SELECT coalesce(jsonb_agg(jsonb_build_object('cadastro', code, 'nome', nome, 'codigo', sugerido) ORDER BY nome), '[]')
                                    FROM _cs WHERE ocupado AND code IS DISTINCT FROM sugerido),
    'amostra', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'de', code, 'para', sugerido)), '[]') FROM
                  (SELECT * FROM _cs WHERE sugerido IS NOT NULL AND code IS DISTINCT FROM sugerido AND NOT representante AND NOT ocupado
                    ORDER BY nome LIMIT 20) x),
    'falhas', falhas);
END $fn$;
REVOKE ALL ON FUNCTION public.party_codigos_smalldata_adotar(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.party_codigos_smalldata_adotar(boolean) TO authenticated, service_role;

-- Busca de cadastros continua achando pelo código antigo (LC-…)
DO $b$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.search_registry(text,integer)'::regprocedure);
  IF position('party_codigo_historico' IN def) = 0 THEN
    novo := replace(def, $q$OR p.code ILIKE '%' || t || '%'$q$,
      $q$OR p.code ILIKE '%' || t || '%'
       OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = p.id AND h.code_antigo ILIKE '%' || t || '%')$q$);
    IF novo = def THEN RAISE EXCEPTION 'search_registry não tem o formato esperado.'; END IF;
    EXECUTE novo;
  END IF;
  def := pg_get_functiondef('public.list_parties(text,text,text,text,integer,integer)'::regprocedure);
  IF position('party_codigo_historico' IN def) = 0 THEN
    novo := replace(def, $q$OR p.code ILIKE '%'||termo||'%'$q$,
      $q$OR p.code ILIKE '%'||termo||'%'
           OR EXISTS (SELECT 1 FROM public.party_codigo_historico h WHERE h.party_id = p.id AND h.code_antigo ILIKE '%'||termo||'%')$q$);
    IF novo = def THEN RAISE EXCEPTION 'list_parties não tem o formato esperado.'; END IF;
    EXECUTE novo;
  END IF;
END $b$;
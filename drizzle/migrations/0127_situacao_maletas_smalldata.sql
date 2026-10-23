-- 0127 — Situação (status) das maletas do SmallData e "na rua" contado por consultora.
--
-- O SmallData registra a situação de cada maleta (T_REM_CLI_STATUS): 1 remessa aberta
-- cliente, 2 remessa alterada, 3 remessa novo kit, 4 saída conferida, 5 a 9 retorno e
-- acerto, 11 remessa perdida. Até aqui o Lardan contava como "na rua" toda maleta sem
-- fechamento — inclusive perdidas, devolvidas aguardando acerto e maletas ainda em montagem.
--
-- O que muda (nada é apagado, nenhuma coluna removida)
--   1. legado_maleta_status: a situação atual de cada consultora na remessa (arquivo novo
--      maletas_status.csv, importado pela mesma tela do histórico).
--   2. legado_maleta_situacoes: nome de cada código e se conta como "na rua". O Master
--      corrige nome e regra por legado_maleta_situacao_definir, sem código novo.
--   3. "Na rua" = sem fechamento E situação marcada como na rua. Sem o arquivo importado,
--      continua como antes (toda maleta sem fechamento).
--   4. O panorama (maletas_visibilidade) passa a dar primeiro CONSULTORAS e depois maletas,
--      e a quebra por situação; a ficha da consultora mostra a situação de cada maleta.

-- ---------------------------------------------------------- 1. situação ---
CREATE TABLE IF NOT EXISTS public.legado_maleta_status (
  remessa int NOT NULL,
  codcli int NOT NULL,
  status smallint NOT NULL,
  data date,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remessa, codcli)
);
ALTER TABLE public.legado_maleta_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maleta_status FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.legado_maleta_status TO service_role;

CREATE TABLE IF NOT EXISTS public.legado_maleta_situacoes (
  codigo smallint PRIMARY KEY,
  nome text NOT NULL,
  na_rua boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.legado_maleta_situacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_maleta_situacoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.legado_maleta_situacoes TO service_role;

-- 1, 2 e 3 vêm do Diego; os demais pela sequência registrada no SmallData (o Master confirma os nomes)
INSERT INTO public.legado_maleta_situacoes (codigo, nome, na_rua, ordem) VALUES
  (1, 'Remessa aberta cliente', false, 1),
  (2, 'Remessa alterada', false, 2),
  (3, 'Remessa novo kit', false, 3),
  (4, 'Saída conferida (na rua)', true, 4),
  (5, 'Retorno recebido', false, 5),
  (6, 'Retorno em contagem', false, 6),
  (7, 'Retorno contado', false, 7),
  (8, 'Em acerto', false, 8),
  (9, 'Finalizada', false, 9),
  (10, 'Situação 10', false, 10),
  (11, 'Remessa perdida', false, 11)
ON CONFLICT (codigo) DO NOTHING;

-- Master ajusta nome e regra "na rua" de um código
CREATE OR REPLACE FUNCTION public.legado_maleta_situacao_definir(_codigo int, _nome text, _na_rua boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN RAISE EXCEPTION 'Só o Master.' USING errcode = '42501'; END IF;
  IF _codigo IS NULL OR _codigo < 0 OR coalesce(btrim(_nome), '') = '' THEN RAISE EXCEPTION 'Informe o código e o nome.'; END IF;
  INSERT INTO legado_maleta_situacoes (codigo, nome, na_rua, ordem) VALUES (_codigo, btrim(_nome), coalesce(_na_rua, false), _codigo)
  ON CONFLICT (codigo) DO UPDATE SET nome = excluded.nome, na_rua = excluded.na_rua, atualizado_em = now();
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'legado.situacao_maleta', 'legado_maleta_situacoes', _codigo::text, jsonb_build_object('nome', btrim(_nome), 'na_rua', _na_rua));
  RETURN jsonb_build_object('codigo', _codigo, 'nome', btrim(_nome), 'na_rua', coalesce(_na_rua, false));
END $fn$;
REVOKE ALL ON FUNCTION public.legado_maleta_situacao_definir(int, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_maleta_situacao_definir(int, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.legado_maleta_situacoes_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.maletas_pode_ver() THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'nome', nome, 'na_rua', na_rua) ORDER BY ordem, codigo)
                     FROM legado_maleta_situacoes), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_maleta_situacoes_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_maleta_situacoes_lista() TO authenticated;

-- Maleta do SmallData sem fechamento está na rua? Sem situação importada, vale a regra antiga (sim).
CREATE OR REPLACE FUNCTION public.legado_maleta_na_rua(_remessa int, _codcli int)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  SELECT coalesce((SELECT n.na_rua FROM legado_maleta_status s JOIN legado_maleta_situacoes n ON n.codigo = s.status
                    WHERE s.remessa = _remessa AND s.codcli = _codcli),
                  (SELECT NOT EXISTS (SELECT 1 FROM legado_maleta_status s WHERE s.remessa = _remessa AND s.codcli = _codcli)))
$fn$;
REVOKE ALL ON FUNCTION public.legado_maleta_na_rua(int, int) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- 2. importação nova ---
DO $imp$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.legado_importar(text,text,jsonb)'::regprocedure);
  IF position('maletas_status' IN def) > 0 THEN RETURN; END IF;
  novo := regexp_replace(def, '(\n\s*CASE _tipo\s*\n)', E'\\1' || $q$  WHEN 'maletas_status' THEN
    INSERT INTO legado_maleta_status AS t (remessa, codcli, status, data)
    SELECT x.remessa::int, x.codcli::int, x.status::numeric::smallint, nullif(x.data,'')::date
      FROM jsonb_to_recordset(_linhas) x(remessa text, codcli text, status text, data text)
     WHERE nullif(x.status,'') IS NOT NULL
    ON CONFLICT (remessa, codcli) DO UPDATE SET status = excluded.status, data = excluded.data, atualizado_em = now();
$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não encontrei o ponto de inserção em legado_importar.'; END IF;
  EXECUTE novo;
END $imp$;

-- ------------------------------------- 3. panorama: consultoras primeiro ---
CREATE OR REPLACE FUNCTION public.maletas_visibilidade(_limite int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT public.maletas_pode_ver() THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  _limite := least(greatest(coalesce(_limite, 200), 1), 1000);
  RETURN (
    WITH ativas AS (
      SELECT c.*, public.maleta_motivo_invisivel(c.id) motivo FROM kit_cycles c
       WHERE c.status IN ('expedida', 'transito', 'recebida', 'operacao', 'acerto')),
    abertas AS (   -- toda maleta do SmallData ainda sem fechamento, com a situação
      SELECT m.*, lr.vencimento, lr.praca, lc.party_id, coalesce(lc.nome, 'Consultora ' || m.codcli) nome,
             s.status, coalesce(n.nome, CASE WHEN s.status IS NULL THEN 'Sem situação importada' ELSE 'Situação ' || s.status END) situacao,
             public.legado_maleta_na_rua(m.remessa, m.codcli) na_rua
        FROM legado_maletas m JOIN legado_remessas lr ON lr.numero = m.remessa
        LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
        LEFT JOIN legado_maleta_status s ON s.remessa = m.remessa AND s.codcli = m.codcli
        LEFT JOIN legado_maleta_situacoes n ON n.codigo = s.status
       WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND NOT coalesce(lc.interna, false)),
    rua AS (SELECT * FROM abertas WHERE na_rua)
    SELECT jsonb_build_object(
      'lardan', jsonb_build_object(
        'ativas', (SELECT count(*) FROM ativas),
        'consultoras', (SELECT count(DISTINCT consultora_party_id) FROM ativas),
        'invisiveis', (SELECT count(*) FROM ativas WHERE motivo IS NOT NULL),
        'lista', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', a.id, 'kit', k.code, 'status', a.status, 'remessa', r.numero,
                    'party_id', a.consultora_party_id, 'consultora', pa.display_name, 'motivo', a.motivo) ORDER BY pa.display_name)
                    FROM (SELECT * FROM ativas WHERE motivo IS NOT NULL LIMIT _limite) a JOIN kits k ON k.id = a.kit_id
                    LEFT JOIN remessas r ON r.id = a.remessa_id LEFT JOIN parties pa ON pa.id = a.consultora_party_id), '[]'::jsonb)),
      'smalldata', jsonb_build_object(
        'situacao_importada', EXISTS (SELECT 1 FROM legado_maleta_status),
        'consultoras', (SELECT count(DISTINCT codcli) FROM rua),
        'maletas', (SELECT count(*) FROM rua),
        'consultoras_varias_maletas', (SELECT count(*) FROM (SELECT codcli FROM rua GROUP BY codcli HAVING count(*) > 1) x),
        'sem_cadastro', (SELECT count(DISTINCT codcli) FROM rua WHERE party_id IS NULL),
        'pecas', (SELECT coalesce(sum(pecas_enviadas), 0) FROM rua),
        'valor_enviado_cents', (SELECT coalesce(sum(valor_enviado_cents), 0) FROM rua),
        'consultoras_atrasadas', (SELECT count(DISTINCT codcli) FROM rua WHERE vencimento < hoje),
        'atrasadas', (SELECT count(*) FROM rua WHERE vencimento < hoje),
        'por_situacao', coalesce((SELECT jsonb_agg(x ORDER BY x.na_rua DESC, x.codigo NULLS LAST) FROM (
            SELECT status codigo, situacao, na_rua, count(DISTINCT codcli) consultoras, count(*) maletas,
                   sum(pecas_enviadas) pecas, sum(valor_enviado_cents) valor_enviado_cents
              FROM abertas GROUP BY status, situacao, na_rua) x), '[]'::jsonb),
        'por_remessa', coalesce((SELECT jsonb_agg(x ORDER BY x.remessa DESC) FROM (
            SELECT r.remessa, min(r.emissao) emissao, max(r.vencimento) vencimento, lp.nome praca,
                   count(DISTINCT r.codcli) consultoras, count(*) maletas,
                   sum(r.pecas_enviadas) pecas, sum(r.valor_enviado_cents) valor_enviado_cents
              FROM rua r LEFT JOIN legado_pracas lp ON lp.codigo = r.praca GROUP BY r.remessa, lp.nome) x), '[]'::jsonb),
        'lista', coalesce((SELECT jsonb_agg(jsonb_build_object('remessa', r.remessa, 'kit', r.kit, 'codcli', r.codcli, 'party_id', r.party_id,
                    'consultora', r.nome, 'emissao', r.emissao, 'vencimento', r.vencimento, 'pecas', r.pecas_enviadas,
                    'valor_enviado_cents', r.valor_enviado_cents, 'situacao', r.situacao) ORDER BY r.remessa DESC, r.nome)
                    FROM (SELECT * FROM rua ORDER BY remessa DESC, nome LIMIT _limite) r), '[]'::jsonb))));
END $fn$;
REVOKE ALL ON FUNCTION public.maletas_visibilidade(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maletas_visibilidade(int) TO authenticated;

-- ---------------------------- 4. ficha da consultora: situação de cada maleta ---
DO $cm$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.consultora_maletas(uuid)'::regprocedure);
  IF position('legado_maleta_situacoes' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def,
    $q$'nf_remessa', m.nf_remessa) ORDER BY m.emissao DESC NULLS LAST)$q$,
    $q$'nf_remessa', m.nf_remessa,
        'situacao_codigo', (SELECT s.status FROM legado_maleta_status s WHERE s.remessa = m.remessa AND s.codcli = m.codcli),
        'situacao', (SELECT n.nome FROM legado_maleta_status s JOIN legado_maleta_situacoes n ON n.codigo = s.status
                      WHERE s.remessa = m.remessa AND s.codcli = m.codcli),
        'na_rua', public.legado_maleta_na_rua(m.remessa, m.codcli)) ORDER BY m.emissao DESC NULLS LAST)$q$);
  IF novo = def THEN RAISE EXCEPTION 'consultora_maletas não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $cm$;
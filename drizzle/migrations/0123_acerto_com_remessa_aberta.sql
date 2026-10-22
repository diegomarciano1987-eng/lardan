-- ============================================================================
-- 0123 — Venda acertada conta mesmo com a remessa ainda aberta
--
-- Achado na conferência de 22/10: várias rotinas só contavam maleta acertada
-- de remessa já ENCERRADA (r.status = 'fechada'). No SmallData a consultora é
-- acertada uma a uma e a remessa só fecha quando a última volta; então os
-- acertos dos meses recentes ficavam de fora da ficha, do ranking livre, do
-- resumo e da sugestão de montagem. O BI novo (0117/0120) já contava certo.
--
--   * ficha da consultora, resumo, sugestão e metas da montagem: maleta com
--     acerto conta, com a remessa aberta ou fechada;
--   * ranking livre (legado_rede_ranking): idem, e ganha _data = 'acerto'
--     (padrão, igual ao SmallData) ou 'saida', como o BI e a série mensal;
--   * série mensal (legado_rede_mensal): soma também os cadastros internos,
--     para bater mês a mês com o relatório de vendas do SmallData.
-- Só leitura: nenhuma coluna ou dado muda.
-- ============================================================================

DO $fech$
DECLARE f text; def text; novo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['legado_consultora_dados(integer[])', 'montagem_sugestao(uuid,integer)', 'legado_resumo()',
                           'montagem_metas_ciclo(uuid,integer)'] LOOP
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    novo := replace(def, 'r.status = ''fechada'' AND m.fechamento IS NOT NULL', 'm.fechamento IS NOT NULL');
    IF novo <> def THEN EXECUTE novo; END IF;
  END LOOP;
END $fech$;

-- Série mensal = total da empresa, igual ao relatório de vendas do SmallData:
-- inclui os acertos dos cadastros internos (loja/LARDAN). Rankings e BI por
-- consultora continuam sem eles.
DO $mensal$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.legado_rede_mensal(date,date,integer,integer,text)'::regprocedure);
  novo := replace(def, 'WHERE m.tipo = ''remessa'' AND NOT coalesce(lc.interna, false)', 'WHERE m.tipo = ''remessa''');
  IF novo <> def THEN EXECUTE novo; END IF;
END $mensal$;

DROP FUNCTION IF EXISTS public.legado_rede_ranking(text,date,date,integer,text,integer);
CREATE OR REPLACE FUNCTION public.legado_rede_ranking(_agrupar text DEFAULT 'praca'::text, _de date DEFAULT NULL::date, _ate date DEFAULT NULL::date, _praca integer DEFAULT NULL::integer, _categoria text DEFAULT NULL::text, _limite integer DEFAULT 50, _data text DEFAULT 'acerto'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _agrupar NOT IN ('praca','representante','cidade','uf','consultora','categoria') THEN RAISE EXCEPTION 'Agrupamento inválido.'; END IF;
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.valor_vendido_cents DESC) FROM (
    WITH base AS (
      SELECT m.remessa, m.codcli, m.kit, m.emissao, r.praca, r.representante, lc.cidade, lc.uf, lc.nome, lc.party_id,
             coalesce(c.categoria, '') categoria,
             coalesce(c.pecas_enviadas, m.pecas_enviadas) env,
             coalesce(c.pecas_enviadas - c.pecas_devolvidas, m.pecas_vendidas) vend,
             coalesce(c.valor_enviado_cents - c.valor_devolvido_cents, m.valor_venda_cents) valor
        FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
        LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
        LEFT JOIN legado_maleta_categorias c ON (_agrupar = 'categoria' OR _categoria IS NOT NULL)
             AND c.remessa = m.remessa AND c.codcli = m.codcli AND c.kit = m.kit
       WHERE m.fechamento IS NOT NULL AND m.tipo = 'remessa'
         AND (_de IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) >= _de)
         AND (_ate IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) <= _ate)
         AND (_praca IS NULL OR r.praca = _praca) AND (_categoria IS NULL OR c.categoria = upper(_categoria)))
    SELECT CASE _agrupar WHEN 'praca' THEN b.praca::text WHEN 'representante' THEN b.representante::text WHEN 'cidade' THEN b.cidade || '/' || b.uf
                         WHEN 'uf' THEN b.uf WHEN 'consultora' THEN b.codcli::text ELSE b.categoria END chave,
           CASE _agrupar WHEN 'praca' THEN max(lp.nome) WHEN 'representante' THEN max(lr.nome) WHEN 'cidade' THEN max(b.cidade) || '/' || max(b.uf)
                         WHEN 'uf' THEN max(b.uf) WHEN 'consultora' THEN max(b.nome) ELSE max(b.categoria) END nome,
           CASE _agrupar WHEN 'consultora' THEN (array_agg(b.party_id) FILTER (WHERE b.party_id IS NOT NULL))[1] END party_id,
           count(DISTINCT (b.remessa, b.codcli, b.kit)) maletas, count(DISTINCT b.codcli) consultoras,
           sum(b.env) pecas_enviadas, sum(b.vend) pecas_vendidas,
           CASE WHEN sum(b.env) > 0 THEN round(100.0 * sum(b.vend) / sum(b.env), 1) END giro_pct,
           sum(b.valor) valor_vendido_cents,
           round(sum(b.valor)::numeric / nullif(count(DISTINCT (b.remessa, b.codcli, b.kit)),0)) ticket_medio_maleta_cents,
           max(b.emissao) ultima_maleta
      FROM base b LEFT JOIN legado_pracas lp ON lp.codigo = b.praca LEFT JOIN legado_representantes lr ON lr.codigo = b.representante
     GROUP BY 1 ORDER BY sum(b.valor) DESC LIMIT least(greatest(coalesce(_limite,50),1),500)) x), '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.legado_rede_ranking(text,date,date,integer,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_rede_ranking(text,date,date,integer,text,integer,text) TO authenticated;

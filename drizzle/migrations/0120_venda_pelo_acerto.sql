-- ============================================================================
-- 0119 — Venda pelo ACERTO da consultora, como o SmallData mostra
--
-- O SmallData soma a venda pelo valor cobrado no acerto de cada consultora
-- (T_REM_CLIENTE.TOTALREMESSA) e pela DATA DO ACERTO. Conferido ao centavo:
-- agosto/2026 R$ 271.290,19 e fevereiro/2026 R$ 303.105,16.
--
--   1. legado_acertos_consultora: valor e data do acerto por remessa e
--      consultora (arquivo acertos_consultora.csv, 11º arquivo da importação).
--   2. legado_maletas ganha valor_acerto_cents (parte de cada kit no acerto,
--      proporcional quando a consultora tem mais de um kit) e valor_venda_cents
--      (o do acerto; sem acerto, peças enviadas − devolvidas). NENHUMA coluna é
--      apagada: valor_vendido_cents fica como estava, marcada como desativada,
--      e todas as rotinas passam a ler valor_venda_cents.
--      acerto_divergente marca as maletas em que o acerto e o detalhe das
--      peças não batem no próprio SmallData (poucas dezenas em ~23 mil acertos).
--   3. BI e série mensal ganham o parâmetro _data: 'acerto' (padrão, igual
--      ao SmallData e ao financeiro) ou 'saida' (mês em que a maleta saiu).
-- ============================================================================

-- ------------------------------------------------------- 1. acertos ---
CREATE TABLE IF NOT EXISTS public.legado_acertos_consultora (
  remessa int NOT NULL, codcli int NOT NULL,
  valor_cents bigint NOT NULL DEFAULT 0, data date,
  tipo text NOT NULL DEFAULT 'remessa' CHECK (tipo IN ('remessa', 'perdida')),
  dinheiro_cents bigint, cheque_cents bigint, prazo_cents bigint, boleto_cents bigint, cartao_cents bigint,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (remessa, codcli)
);
CREATE INDEX IF NOT EXISTS legado_acertos_consultora_data_idx ON public.legado_acertos_consultora (data);
ALTER TABLE public.legado_acertos_consultora ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legado_acertos_consultora FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.legado_acertos_consultora TO service_role;

-- --------------------------------------- 2. valor do acerto na maleta ---
-- Nada é apagado. Colunas novas:
--   valor_acerto_cents  parte desta maleta (kit) no valor cobrado no acerto
--   acerto_divergente   acerto difere em mais de R$ 1 das peças marcadas como vendidas
--   valor_venda_cents   valor da venda que o sistema passa a ler: o do acerto; sem acerto,
--                       peças enviadas − devolvidas
-- A antiga valor_vendido_cents fica como estava, marcada como desativada.
ALTER TABLE public.legado_maletas ADD COLUMN IF NOT EXISTS valor_acerto_cents bigint;
ALTER TABLE public.legado_maletas ADD COLUMN IF NOT EXISTS acerto_divergente boolean NOT NULL DEFAULT false;
ALTER TABLE public.legado_maletas ADD COLUMN IF NOT EXISTS valor_venda_cents bigint
  GENERATED ALWAYS AS (coalesce(valor_acerto_cents, valor_enviado_cents - valor_devolvido_cents)) STORED;
COMMENT ON COLUMN public.legado_maletas.valor_vendido_cents IS
  'DESATIVADA desde a 0119: valor pelas peças (enviado − devolvido). Use valor_venda_cents, que segue o valor cobrado no acerto, como o SmallData.';
COMMENT ON COLUMN public.legado_maletas.valor_venda_cents IS
  'Valor da venda: parte da maleta no acerto da consultora (valor_acerto_cents); sem acerto importado, enviado − devolvido.';

-- Reparte o valor do acerto entre os kits da consultora na remessa: proporcional
-- ao valor das peças vendidas de cada kit; o primeiro kit fica com o resto
-- (soma exata). Sem venda nas peças, o primeiro kit leva tudo.
CREATE OR REPLACE FUNCTION public.legado_acertos_distribuir(_chaves jsonb)
RETURNS int LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE n int;
BEGIN
  WITH ch AS (SELECT DISTINCT (c->>0)::int remessa, (c->>1)::int codcli FROM jsonb_array_elements(_chaves) c),
  a AS (SELECT ac.remessa, ac.codcli, ac.valor_cents FROM legado_acertos_consultora ac JOIN ch USING (remessa, codcli)),
  k AS (SELECT m.remessa, m.codcli, m.kit, a.valor_cents,
               greatest(m.valor_enviado_cents - m.valor_devolvido_cents, 0) base,
               row_number() OVER (PARTITION BY m.remessa, m.codcli ORDER BY m.kit) rn,
               sum(greatest(m.valor_enviado_cents - m.valor_devolvido_cents, 0)) OVER (PARTITION BY m.remessa, m.codcli) tot
          FROM legado_maletas m JOIN a USING (remessa, codcli)),
  s AS (SELECT k.*, CASE WHEN k.tot > 0 THEN floor(k.valor_cents::numeric * k.base / k.tot)::bigint ELSE 0 END parte FROM k),
  f AS (SELECT s.remessa, s.codcli, s.kit, abs(s.valor_cents - s.tot) > 100 divergente,
               CASE WHEN s.rn = 1 THEN s.valor_cents - (sum(s.parte) OVER (PARTITION BY s.remessa, s.codcli) - s.parte) ELSE s.parte END valor
          FROM s)
  UPDATE legado_maletas m SET valor_acerto_cents = f.valor, acerto_divergente = f.divergente
    FROM f WHERE m.remessa = f.remessa AND m.codcli = f.codcli AND m.kit = f.kit
     AND (m.valor_acerto_cents IS DISTINCT FROM f.valor OR m.acerto_divergente IS DISTINCT FROM f.divergente);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_acertos_distribuir(jsonb) FROM PUBLIC, anon, authenticated;

-- acertos importados depois das maletas
CREATE OR REPLACE FUNCTION public.legado_acertos_aplicar()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.legado_acertos_distribuir((SELECT jsonb_agg(jsonb_build_array(remessa, codcli)) FROM novas));
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS legado_acertos_aplicar_ins ON public.legado_acertos_consultora;
DROP TRIGGER IF EXISTS legado_acertos_aplicar_upd ON public.legado_acertos_consultora;
CREATE TRIGGER legado_acertos_aplicar_ins AFTER INSERT ON public.legado_acertos_consultora
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_acertos_aplicar();
CREATE TRIGGER legado_acertos_aplicar_upd AFTER UPDATE ON public.legado_acertos_consultora
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_acertos_aplicar();

-- maletas (re)importadas depois dos acertos; o próprio repasse não dispara de novo
CREATE OR REPLACE FUNCTION public.legado_maletas_aplicar_acerto()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  PERFORM public.legado_acertos_distribuir((SELECT jsonb_agg(DISTINCT jsonb_build_array(remessa, codcli)) FROM novas));
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS legado_maletas_aplicar_acerto_ins ON public.legado_maletas;
DROP TRIGGER IF EXISTS legado_maletas_aplicar_acerto_upd ON public.legado_maletas;
CREATE TRIGGER legado_maletas_aplicar_acerto_ins AFTER INSERT ON public.legado_maletas
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_maletas_aplicar_acerto();
CREATE TRIGGER legado_maletas_aplicar_acerto_upd AFTER UPDATE ON public.legado_maletas
  REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_maletas_aplicar_acerto();

-- importação: tipo novo "acertos_consultora" (injetado na rotina da 0112, sem mudar os demais tipos)
DO $imp$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.legado_importar(text,text,jsonb)'::regprocedure);
  IF position('acertos_consultora' IN def) > 0 THEN RETURN; END IF;
  novo := regexp_replace(def, '(\n\s*CASE _tipo\s*\n)', E'\\1' || $q$  WHEN 'acertos_consultora' THEN
    INSERT INTO legado_acertos_consultora AS t (remessa, codcli, valor_cents, data, tipo, dinheiro_cents, cheque_cents, prazo_cents, boleto_cents, cartao_cents)
    SELECT x.remessa::int, x.codcli::int, round(coalesce(nullif(x.valor,''),'0')::numeric * 100)::bigint, nullif(x.data,'')::date,
           CASE WHEN x.tipo = 'perdida' THEN 'perdida' ELSE 'remessa' END,
           round(nullif(x.dinheiro,'')::numeric * 100)::bigint, round(nullif(x.cheque,'')::numeric * 100)::bigint,
           round(nullif(x.prazo,'')::numeric * 100)::bigint, round(nullif(x.boleto,'')::numeric * 100)::bigint,
           round(nullif(x.cartao,'')::numeric * 100)::bigint
      FROM jsonb_to_recordset(_linhas) x(remessa text, codcli text, valor text, data text, tipo text,
           dinheiro text, cheque text, prazo text, boleto text, cartao text)
    ON CONFLICT (remessa, codcli) DO UPDATE SET valor_cents = excluded.valor_cents, data = excluded.data, tipo = excluded.tipo,
      dinheiro_cents = excluded.dinheiro_cents, cheque_cents = excluded.cheque_cents, prazo_cents = excluded.prazo_cents,
      boleto_cents = excluded.boleto_cents, cartao_cents = excluded.cartao_cents, atualizado_em = now();
$q$);
  IF novo = def THEN RAISE EXCEPTION 'Não encontrei o ponto de inserção em legado_importar.'; END IF;
  EXECUTE novo;
END $imp$;


-- -------------------- rotinas anteriores leem valor_venda_cents ---
-- Troca só a leitura da coluna da maleta (m.valor_vendido_cents e as somas sobre linhas
-- de legado_maletas); nomes de campo devolvidos às telas continuam iguais.
DO $col$
DECLARE f text; def text; novo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['legado_consultora_dados(integer[])', 'legado_remessas_lista(text,integer,integer,date,date,text,integer,integer)',
                           'legado_remessa_detalhe(integer)', 'legado_rede_ranking(text,date,date,integer,text,integer)',
                           'legado_resumo()', 'montagem_metas_ciclo(uuid,integer)'] LOOP
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    novo := replace(def, 'm.valor_vendido_cents', 'm.valor_venda_cents');
    novo := replace(novo, 'sum(valor_vendido_cents)', 'sum(valor_venda_cents)');   -- CTEs que são linhas da própria legado_maletas
    IF novo = def THEN
      IF position('valor_venda_cents' IN def) > 0 THEN CONTINUE; END IF;   -- já aplicada
      RAISE EXCEPTION 'Rotina % não lê a coluna da maleta como esperado.', f;
    END IF;
    EXECUTE novo;
  END LOOP;
END $col$;

-- ------------------------------------------- 3. data do acerto no BI ---
DROP FUNCTION IF EXISTS public.legado_bi_insights(date,date,int,int);
DROP FUNCTION IF EXISTS public.legado_bi_painel(date,date,int,int);
DROP FUNCTION IF EXISTS public.legado_bi_top(date,date,int,int,text,boolean,int,int);
DROP FUNCTION IF EXISTS public.legado_bi_jornada(date,date,int,int);
DROP FUNCTION IF EXISTS public.legado_bi_praca_categoria(date,date,int);
DROP FUNCTION IF EXISTS public.legado_bi_produtos(date,date,int,int,text,int);
DROP FUNCTION IF EXISTS public.legado_bi_kpis(date,date,int,int);
DROP FUNCTION IF EXISTS public.legado_bi_base(date,date,int,int);
DROP FUNCTION IF EXISTS public.legado_rede_mensal(date,date,int,int);

CREATE OR REPLACE FUNCTION public.legado_rede_mensal(_de date DEFAULT NULL, _ate date DEFAULT NULL, _praca int DEFAULT NULL,
  _representante int DEFAULT NULL, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.mes) FROM (
    SELECT to_char(date_trunc('month', CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END), 'YYYY-MM') mes,
           count(*) maletas, count(DISTINCT m.codcli) consultoras,
           sum(m.pecas_enviadas) pecas_enviadas, sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL) pecas_vendidas,
           sum(m.valor_venda_cents) FILTER (WHERE m.fechamento IS NOT NULL) valor_vendido_cents,
           CASE WHEN sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL) > 0
                THEN round(100.0 * sum(m.pecas_vendidas) FILTER (WHERE m.fechamento IS NOT NULL) / sum(m.pecas_enviadas) FILTER (WHERE m.fechamento IS NOT NULL), 1) END giro_pct
      FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
      LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
     WHERE m.tipo = 'remessa' AND NOT coalesce(lc.interna, false)
       AND (_data = 'saida' OR m.fechamento IS NOT NULL)
       AND (_de IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) >= _de)
       AND (_ate IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) <= _ate)
       AND (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)
     GROUP BY 1) x), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_rede_mensal(date,date,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_rede_mensal(date,date,int,int,text) TO authenticated;

-- Recorte comum: maletas acertadas. Interna (sem GRANT): só as rotinas abaixo usam.
CREATE OR REPLACE FUNCTION public.legado_bi_base(_de date, _ate date, _praca int, _representante int, _data text DEFAULT 'acerto')
RETURNS TABLE (remessa int, codcli int, kit int, emissao date, fechamento date, praca int, representante int,
               pecas_enviadas int, pecas_vendidas int, valor_enviado_cents bigint, valor_vendido_cents bigint, dias int, data_ref date)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT m.remessa, m.codcli, m.kit, m.emissao, m.fechamento, r.praca, r.representante,
         m.pecas_enviadas, m.pecas_vendidas, m.valor_enviado_cents, m.valor_venda_cents, (m.fechamento - m.emissao),
         CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END
    FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
    LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
   WHERE m.tipo = 'remessa' AND m.fechamento IS NOT NULL AND m.pecas_enviadas > 0 AND NOT coalesce(lc.interna, false)
     AND (_de IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) >= _de)
     AND (_ate IS NULL OR (CASE WHEN _data = 'saida' THEN m.emissao ELSE m.fechamento END) <= _ate)
     AND (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)
$$;
REVOKE ALL ON FUNCTION public.legado_bi_base(date,date,int,int,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.legado_bi_exigir()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.legado_pode_ver(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.legado_bi_exigir() FROM PUBLIC, anon, authenticated;

-- KPIs de um recorte (interna).
CREATE OR REPLACE FUNCTION public.legado_bi_kpis(_de date, _ate date, _praca int, _representante int, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'maletas', count(*), 'consultoras', count(DISTINCT codcli), 'remessas', count(DISTINCT remessa),
    'pecas_enviadas', coalesce(sum(pecas_enviadas), 0), 'pecas_vendidas', coalesce(sum(pecas_vendidas), 0),
    'giro_pct', round(100.0 * sum(pecas_vendidas) / nullif(sum(pecas_enviadas), 0), 1),
    'valor_vendido_cents', coalesce(sum(valor_vendido_cents), 0),
    'ticket_medio_cents', round(avg(valor_vendido_cents))::bigint,
    'ticket_mediano_cents', (percentile_disc(0.5) WITHIN GROUP (ORDER BY valor_vendido_cents))::bigint,
    'preco_medio_vendido_cents', round(sum(valor_vendido_cents)::numeric / nullif(sum(pecas_vendidas), 0))::bigint,
    'maletas_zeradas', count(*) FILTER (WHERE pecas_vendidas = 0),
    'maletas_zeradas_pct', round(100.0 * count(*) FILTER (WHERE pecas_vendidas = 0) / nullif(count(*), 0), 1),
    'venda_por_consultora_cents', round(sum(valor_vendido_cents)::numeric / nullif(count(DISTINCT codcli), 0))::bigint,
    'dias_na_rua_mediana', percentile_disc(0.5) WITHIN GROUP (ORDER BY dias),
    -- maletas do recorte ainda sem acerto: enquanto houver, valores do período são parciais
    'maletas_sem_acerto', (SELECT count(*) FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
                            LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
                            WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND NOT coalesce(lc.interna, false)
                              AND (_de IS NULL OR m.emissao >= _de) AND (_ate IS NULL OR m.emissao <= _ate)
                              AND (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante)))
  FROM public.legado_bi_base(_de, _ate, _praca, _representante, _data)
$$;
REVOKE ALL ON FUNCTION public.legado_bi_kpis(date,date,int,int,text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------ painel ---
CREATE OR REPLACE FUNCTION public.legado_bi_painel(_de date DEFAULT NULL, _ate date DEFAULT NULL,
                                                  _praca int DEFAULT NULL, _representante int DEFAULT NULL, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE res jsonb; ant jsonb := NULL; dur int;
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  IF _de IS NOT NULL AND _ate IS NOT NULL AND _ate >= _de THEN
    dur := _ate - _de;
    ant := public.legado_bi_kpis(_de - dur - 1, _de - 1, _praca, _representante, _data);
  END IF;

  WITH f AS (SELECT * FROM public.legado_bi_base(_de, _ate, _praca, _representante, _data)),
  cheia AS (SELECT * FROM f WHERE pecas_enviadas >= 10),   -- kit de complemento não distorce as curvas
  c AS (SELECT codcli, sum(valor_vendido_cents) v FROM f GROUP BY 1),
  rk AS (SELECT v, row_number() OVER (ORDER BY v DESC) k, count(*) OVER () n, sum(v) OVER () t FROM c)
  SELECT jsonb_build_object(
    'kpis', public.legado_bi_kpis(_de, _ate, _praca, _representante, _data),
    'anterior', ant,
    'distribuicao', (SELECT coalesce(jsonb_agg(x ORDER BY x.ordem), '[]') FROM (
        SELECT CASE WHEN pecas_vendidas = 0 THEN 0 WHEN p < 5 THEN 1 WHEN p < 10 THEN 2 WHEN p < 20 THEN 3 WHEN p < 30 THEN 4 ELSE 5 END ordem,
               CASE WHEN pecas_vendidas = 0 THEN 'Nada vendido' WHEN p < 5 THEN 'até 5%' WHEN p < 10 THEN '5–10%'
                    WHEN p < 20 THEN '10–20%' WHEN p < 30 THEN '20–30%' ELSE '30% ou mais' END faixa,
               count(*) maletas, round(100.0 * count(*) / sum(count(*)) OVER (), 1) pct, sum(valor_vendido_cents) valor_vendido_cents
          FROM (SELECT *, 100.0 * pecas_vendidas / pecas_enviadas p FROM cheia) z GROUP BY 1, 2) x),
    'pareto', jsonb_build_object(
        'top10_pct', (SELECT round(100.0 * sum(v) FILTER (WHERE k <= ceil(n * 0.1)) / nullif(max(t), 0), 1) FROM rk),
        'top20_pct', (SELECT round(100.0 * sum(v) FILTER (WHERE k <= ceil(n * 0.2)) / nullif(max(t), 0), 1) FROM rk),
        'top50_pct', (SELECT round(100.0 * sum(v) FILTER (WHERE k <= ceil(n * 0.5)) / nullif(max(t), 0), 1) FROM rk),
        'curva', (SELECT coalesce(jsonb_agg(jsonb_build_object('consultoras_pct', q * 5, 'venda_pct',
                    (SELECT round(100.0 * sum(v) / nullif(max(t), 0), 1) FROM rk WHERE k <= ceil(n * q * 0.05))) ORDER BY q), '[]')
                    FROM generate_series(1, 20) q)),
    'tamanho', (SELECT coalesce(jsonb_agg(x ORDER BY x.ordem), '[]') FROM (
        SELECT CASE WHEN pecas_enviadas < 40 THEN 1 WHEN pecas_enviadas < 60 THEN 2 WHEN pecas_enviadas < 80 THEN 3 WHEN pecas_enviadas < 100 THEN 4 ELSE 5 END ordem,
               CASE WHEN pecas_enviadas < 40 THEN '10–39' WHEN pecas_enviadas < 60 THEN '40–59' WHEN pecas_enviadas < 80 THEN '60–79'
                    WHEN pecas_enviadas < 100 THEN '80–99' ELSE '100+' END faixa,
               count(*) maletas, round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) giro_pct,
               round(avg(pecas_vendidas), 1) pecas_vendidas_media, round(avg(valor_vendido_cents))::bigint ticket_medio_cents
          FROM cheia GROUP BY 1, 2) x),
    'dias_na_rua', (SELECT coalesce(jsonb_agg(x ORDER BY x.ordem), '[]') FROM (
        SELECT CASE WHEN dias < 35 THEN 1 WHEN dias < 50 THEN 2 WHEN dias < 65 THEN 3 WHEN dias < 90 THEN 4 ELSE 5 END ordem,
               CASE WHEN dias < 35 THEN 'até 34 dias' WHEN dias < 50 THEN '35–49' WHEN dias < 65 THEN '50–64'
                    WHEN dias < 90 THEN '65–89' ELSE '90 ou mais' END faixa,
               count(*) maletas, round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) giro_pct,
               round(avg(valor_vendido_cents))::bigint ticket_medio_cents
          FROM cheia WHERE dias IS NOT NULL GROUP BY 1, 2) x),
    'sazonalidade', (SELECT coalesce(jsonb_agg(x ORDER BY x.mes), '[]') FROM (
        SELECT extract(month FROM data_ref)::int mes, count(*) maletas,
               round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) giro_pct,
               (percentile_disc(0.5) WITHIN GROUP (ORDER BY valor_vendido_cents))::bigint ticket_mediano_cents
          FROM cheia WHERE data_ref IS NOT NULL GROUP BY 1) x),
    'mix', (SELECT coalesce(jsonb_agg(x ORDER BY x.pecas_enviadas DESC), '[]') FROM (
        SELECT coalesce(nullif(cat.categoria, ''), 'SEM CATEGORIA') categoria, sum(cat.pecas_enviadas) pecas_enviadas,
               sum(cat.pecas_enviadas - cat.pecas_devolvidas) pecas_vendidas,
               round(100.0 * sum(cat.pecas_enviadas) / sum(sum(cat.pecas_enviadas)) OVER (), 1) envio_pct,
               round(100.0 * sum(cat.pecas_enviadas - cat.pecas_devolvidas) / nullif(sum(sum(cat.pecas_enviadas - cat.pecas_devolvidas)) OVER (), 0), 1) venda_pct,
               round(100.0 * sum(cat.pecas_enviadas - cat.pecas_devolvidas) / nullif(sum(cat.pecas_enviadas), 0), 1) giro_pct,
               sum(cat.valor_enviado_cents - cat.valor_devolvido_cents) valor_vendido_cents
          FROM legado_maleta_categorias cat JOIN f USING (remessa, codcli, kit) GROUP BY 1) x),
    'anos', (SELECT coalesce(jsonb_agg(x ORDER BY x.ano), '[]') FROM (
        SELECT extract(year FROM data_ref)::int ano, count(*) maletas, count(DISTINCT codcli) consultoras,
               round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) giro_pct, sum(valor_vendido_cents) valor_vendido_cents,
               round(avg(valor_vendido_cents))::bigint ticket_medio_cents
          FROM f WHERE data_ref IS NOT NULL GROUP BY 1) x)
  ) INTO res;
  RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_painel(date,date,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_painel(date,date,int,int,text) TO authenticated;

-- ---------------------------------------------------- top consultoras ---
-- _criterio: valor | giro | pecas | ticket. Giro e ticket exigem _min_maletas.
-- _por_praca = true devolve o top N de CADA praça.
CREATE OR REPLACE FUNCTION public.legado_bi_top(_de date DEFAULT NULL, _ate date DEFAULT NULL, _praca int DEFAULT NULL,
  _representante int DEFAULT NULL, _criterio text DEFAULT 'valor', _por_praca boolean DEFAULT false,
  _limite int DEFAULT 10, _min_maletas int DEFAULT 3, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  IF _criterio NOT IN ('valor','giro','pecas','ticket') THEN RAISE EXCEPTION 'Critério inválido.'; END IF;
  _limite := least(greatest(coalesce(_limite, 10), 1), 100);
  RETURN coalesce((
    WITH f AS (SELECT * FROM public.legado_bi_base(_de, _ate, _praca, _representante, _data)),
    -- praça da consultora = a da maleta mais recente no recorte
    pc AS (SELECT DISTINCT ON (codcli) codcli, praca FROM f ORDER BY codcli, emissao DESC NULLS LAST),
    seq AS (SELECT codcli, pecas_enviadas, pecas_vendidas,
                   row_number() OVER (PARTITION BY codcli ORDER BY emissao DESC NULLS LAST, remessa DESC) k FROM f),
    tend AS (SELECT codcli,
                    round(100.0 * sum(pecas_vendidas) FILTER (WHERE k <= 3) / nullif(sum(pecas_enviadas) FILTER (WHERE k <= 3), 0), 1) giro_recente,
                    round(100.0 * sum(pecas_vendidas) FILTER (WHERE k > 3) / nullif(sum(pecas_enviadas) FILTER (WHERE k > 3), 0), 1) giro_antes
               FROM seq GROUP BY 1),
    agg AS (SELECT f.codcli, count(*) maletas, sum(pecas_enviadas) env, sum(pecas_vendidas) vend,
                   round(100.0 * sum(pecas_vendidas) / sum(pecas_enviadas), 1) giro, sum(valor_vendido_cents) valor,
                   round(avg(valor_vendido_cents))::bigint ticket, max(emissao) ultima, min(emissao) primeira
              FROM f GROUP BY 1),
    forte AS (SELECT DISTINCT ON (cat.codcli) cat.codcli, cat.categoria
                FROM legado_maleta_categorias cat JOIN f USING (remessa, codcli, kit)
               GROUP BY cat.codcli, cat.categoria ORDER BY cat.codcli, sum(cat.pecas_enviadas - cat.pecas_devolvidas) DESC),
    base AS (SELECT a.*, pc.praca, t.giro_recente, t.giro_antes, fo.categoria categoria_mais_vendida,
                    CASE _criterio WHEN 'valor' THEN a.valor::numeric WHEN 'pecas' THEN a.vend::numeric
                                   WHEN 'giro' THEN a.giro WHEN 'ticket' THEN a.ticket::numeric END metrica
               FROM agg a JOIN pc USING (codcli) LEFT JOIN tend t USING (codcli) LEFT JOIN forte fo USING (codcli)
              WHERE _criterio IN ('valor','pecas') OR a.maletas >= coalesce(_min_maletas, 3)),
    ord AS (SELECT b.*, row_number() OVER (PARTITION BY CASE WHEN _por_praca THEN b.praca END ORDER BY b.metrica DESC NULLS LAST, b.valor DESC) pos
              FROM base b)
    SELECT jsonb_agg(jsonb_build_object(
             'posicao', o.pos, 'codcli', o.codcli, 'party_id', lc.party_id, 'nome', coalesce(lc.nome, 'Consultora ' || o.codcli),
             'cidade', lc.cidade, 'uf', lc.uf, 'praca', o.praca, 'praca_nome', lp.nome,
             'maletas', o.maletas, 'pecas_enviadas', o.env, 'pecas_vendidas', o.vend, 'giro_pct', o.giro,
             'valor_vendido_cents', o.valor, 'ticket_medio_cents', o.ticket, 'primeira_maleta', o.primeira, 'ultima_maleta', o.ultima,
             'giro_recente_pct', o.giro_recente, 'giro_antes_pct', o.giro_antes,
             'tendencia', CASE WHEN o.giro_antes IS NULL OR o.giro_recente IS NULL THEN NULL
                               WHEN o.giro_recente >= o.giro_antes * 1.15 THEN 'subindo'
                               WHEN o.giro_recente <= o.giro_antes * 0.85 THEN 'caindo' ELSE 'estavel' END,
             'categoria_mais_vendida', o.categoria_mais_vendida)
           ORDER BY CASE WHEN _por_praca THEN lp.nome END NULLS FIRST, o.pos)
      FROM ord o LEFT JOIN legado_consultoras lc ON lc.codcli = o.codcli LEFT JOIN legado_pracas lp ON lp.codigo = o.praca
     WHERE o.pos <= _limite), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_top(date,date,int,int,text,boolean,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_top(date,date,int,int,text,boolean,int,int,text) TO authenticated;

-- ----------------------------------------------------------- jornada ---
-- "Maleta" aqui = uma remessa da consultora (kits de complemento da mesma remessa somados).
CREATE OR REPLACE FUNCTION public.legado_bi_jornada(_de date DEFAULT NULL, _ate date DEFAULT NULL,
                                                   _praca int DEFAULT NULL, _representante int DEFAULT NULL, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE res jsonb; corte date;
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  -- "parou" = última maleta há mais de 120 dias da última emissão registrada
  SELECT max(emissao) - 120 INTO corte FROM legado_maletas;
  WITH todas AS (   -- jornada usa a vida inteira da consultora; o recorte escolhe QUEM entra
    SELECT codcli, remessa, min(emissao) em, sum(pecas_enviadas) env, sum(pecas_vendidas) vend, sum(valor_vendido_cents) v
      FROM public.legado_bi_base(NULL, NULL, _praca, _representante, _data) GROUP BY 1, 2),
  quem AS (SELECT DISTINCT codcli FROM public.legado_bi_base(_de, _ate, _praca, _representante, _data)),
  seq AS (SELECT t.*, row_number() OVER w k, count(*) OVER (PARTITION BY t.codcli) tot,
                 lead(t.vend) OVER w prox_vend, lead(t.env) OVER w prox_env
            FROM todas t JOIN quem USING (codcli) WINDOW w AS (PARTITION BY t.codcli ORDER BY t.em, t.remessa)),
  prim AS (SELECT codcli, min(em) primeira, max(em) ultima FROM todas GROUP BY 1)
  SELECT jsonb_build_object(
    'curva', (SELECT coalesce(jsonb_agg(x ORDER BY x.n), '[]') FROM (
        SELECT least(k, 12) n, count(*) consultoras, round(100.0 * sum(vend) / nullif(sum(env), 0), 1) giro_pct,
               round(avg(v))::bigint venda_media_cents, round(100.0 * count(*) FILTER (WHERE tot > k) / count(*), 1) voltou_pct
          FROM seq GROUP BY 1) x),
    'primeira_maleta', (SELECT coalesce(jsonb_agg(x ORDER BY x.zerada), '[]') FROM (
        SELECT (vend = 0) zerada, count(*) consultoras, round(100.0 * count(prox_env) / count(*), 1) recebeu_segunda_pct,
               round(100.0 * sum(prox_vend) / nullif(sum(prox_env), 0), 1) giro_segunda_pct
          FROM seq WHERE k = 1 GROUP BY 1) x),
    'trimestres', (SELECT coalesce(jsonb_agg(x ORDER BY x.q), '[]') FROM (
        SELECT q, to_char(q, 'YYYY') || '-T' || extract(quarter FROM q) trimestre,
               coalesce(a.n, 0) ativas, coalesce(nv.n, 0) novas, coalesce(pr.n, 0) pararam
          FROM generate_series(date_trunc('quarter', (SELECT min(em) FROM todas)), date_trunc('quarter', (SELECT max(em) FROM todas)), interval '3 months') q
          LEFT JOIN (SELECT date_trunc('quarter', t.em) q, count(DISTINCT t.codcli) n FROM todas t JOIN quem USING (codcli) GROUP BY 1) a USING (q)
          LEFT JOIN (SELECT date_trunc('quarter', p.primeira) q, count(*) n FROM prim p JOIN quem USING (codcli) GROUP BY 1) nv USING (q)
          LEFT JOIN (SELECT date_trunc('quarter', p.ultima) q, count(*) n FROM prim p JOIN quem USING (codcli) WHERE p.ultima < corte GROUP BY 1) pr USING (q)) x),
    'parou_apos', (SELECT coalesce(jsonb_agg(x ORDER BY x.n), '[]') FROM (
        SELECT least(tot, 10) n, count(*) consultoras FROM (SELECT DISTINCT codcli, tot FROM seq) d
          JOIN prim p USING (codcli) WHERE p.ultima < corte GROUP BY 1) x),
    'corte_parou', corte
  ) INTO res;
  RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_jornada(date,date,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_jornada(date,date,int,int,text) TO authenticated;

-- ----------------------------------------------------------- alertas ---
CREATE OR REPLACE FUNCTION public.legado_bi_alertas(_praca int DEFAULT NULL, _representante int DEFAULT NULL, _limite int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE res jsonb; hoje date;
BEGIN
  PERFORM public.legado_bi_exigir();
  _limite := least(greatest(coalesce(_limite, 30), 1), 200);
  SELECT max(emissao) INTO hoje FROM legado_maletas;   -- "hoje" do histórico
  WITH todas AS (
    SELECT codcli, remessa, min(emissao) em, max(praca) praca, sum(pecas_enviadas) env, sum(pecas_vendidas) vend, sum(valor_vendido_cents) v
      FROM public.legado_bi_base(NULL, NULL, _praca, _representante) GROUP BY 1, 2),
  seq AS (SELECT t.*, row_number() OVER w k, count(*) OVER (PARTITION BY codcli) tot, lead(t.vend) OVER w vend_anterior
            FROM todas t WINDOW w AS (PARTITION BY codcli ORDER BY em DESC, remessa DESC)),
  rede AS (SELECT round(100.0 * sum(vend) / nullif(sum(env), 0), 1) giro FROM todas),
  porpraca AS (SELECT praca, 100.0 * sum(vend) / nullif(sum(env), 0) giro FROM todas GROUP BY 1),
  ultima AS (SELECT codcli, max(em) ultima, sum(v) valor, sum(vend) vend, sum(env) env FROM todas GROUP BY 1),
  -- maletas na rua agora (sem acerto), por consultora
  rua AS (SELECT m.codcli, count(*) maletas, sum(m.pecas_enviadas) pecas FROM legado_maletas m JOIN legado_remessas r ON r.numero = m.remessa
           LEFT JOIN legado_consultoras lc ON lc.codcli = m.codcli
           WHERE m.tipo = 'remessa' AND m.fechamento IS NULL AND NOT coalesce(lc.interna, false)
             AND (_praca IS NULL OR r.praca = _praca) AND (_representante IS NULL OR r.representante = _representante) GROUP BY 1),
  z2 AS (SELECT s1.codcli, s1.em ultima, s1.praca, coalesce(rua.pecas, 0) pecas_na_rua
           FROM seq s1 LEFT JOIN rua ON rua.codcli = s1.codcli
          WHERE s1.k = 1 AND s1.vend = 0 AND s1.vend_anterior = 0),
  queda AS (SELECT codcli, max(praca) praca,
                   round(100.0 * sum(vend) FILTER (WHERE k <= 3) / nullif(sum(env) FILTER (WHERE k <= 3), 0), 1) recente,
                   round(100.0 * sum(vend) FILTER (WHERE k > 3) / nullif(sum(env) FILTER (WHERE k > 3), 0), 1) antes,
                   max(em) ultima
              FROM seq WHERE tot >= 6 GROUP BY 1),
  top AS (SELECT u.*, ntile(5) OVER (ORDER BY u.valor DESC) quinto FROM ultima u),
  estreia AS (SELECT s.codcli, s.praca, s.em, round(100.0 * s.vend / nullif(s.env, 0), 1) giro, s.v
                FROM seq s JOIN porpraca pp ON pp.praca = s.praca
               WHERE s.tot <= 2 AND s.k = 1 AND s.em >= hoje - 180 AND s.env >= 10 AND 100.0 * s.vend / s.env >= 2 * pp.giro),
  nomeia AS (SELECT lc.codcli, lc.party_id, coalesce(lc.nome, 'Consultora ' || lc.codcli) nome, lc.cidade, lc.uf FROM legado_consultoras lc)
  SELECT jsonb_build_object(
    'hoje', hoje,
    'giro_rede_pct', (SELECT giro FROM rede),
    'zeraram_duas', jsonb_build_object(
        'consultoras', (SELECT count(*) FROM z2),
        'com_maleta_na_rua', (SELECT count(*) FROM z2 WHERE pecas_na_rua > 0),
        'pecas_na_rua', (SELECT coalesce(sum(pecas_na_rua), 0) FROM z2),
        'lista', (SELECT coalesce(jsonb_agg(jsonb_build_object('codcli', z.codcli, 'party_id', n.party_id, 'nome', n.nome, 'cidade', n.cidade,
                    'praca_nome', lp.nome, 'ultima_maleta', z.ultima, 'pecas_na_rua', z.pecas_na_rua) ORDER BY z.pecas_na_rua DESC, z.ultima DESC), '[]')
                    FROM (SELECT * FROM z2 ORDER BY pecas_na_rua DESC, ultima DESC LIMIT _limite) z
                    JOIN nomeia n USING (codcli) LEFT JOIN legado_pracas lp ON lp.codigo = z.praca)),
    'em_queda', (SELECT coalesce(jsonb_agg(jsonb_build_object('codcli', q.codcli, 'party_id', n.party_id, 'nome', n.nome, 'praca_nome', lp.nome,
                    'giro_recente_pct', q.recente, 'giro_antes_pct', q.antes, 'ultima_maleta', q.ultima) ORDER BY q.antes - q.recente DESC), '[]')
                    FROM (SELECT * FROM queda WHERE antes >= 8 AND recente <= antes * 0.5 AND ultima >= hoje - 120
                           ORDER BY antes - recente DESC LIMIT _limite) q
                    JOIN nomeia n USING (codcli) LEFT JOIN legado_pracas lp ON lp.codigo = q.praca),
    'sumiram', (SELECT coalesce(jsonb_agg(jsonb_build_object('codcli', t.codcli, 'party_id', n.party_id, 'nome', n.nome, 'cidade', n.cidade,
                    'valor_vendido_cents', t.valor, 'giro_pct', round(100.0 * t.vend / nullif(t.env, 0), 1), 'ultima_maleta', t.ultima,
                    'dias_sem_maleta', hoje - t.ultima) ORDER BY t.valor DESC), '[]')
                    FROM (SELECT * FROM top WHERE quinto = 1 AND ultima < hoje - 120 AND codcli NOT IN (SELECT codcli FROM rua)
                           ORDER BY valor DESC LIMIT _limite) t
                    JOIN nomeia n USING (codcli)),
    'estreantes', (SELECT coalesce(jsonb_agg(jsonb_build_object('codcli', e.codcli, 'party_id', n.party_id, 'nome', n.nome, 'praca_nome', lp.nome,
                    'giro_pct', e.giro, 'valor_vendido_cents', e.v, 'emissao', e.em) ORDER BY e.giro DESC), '[]')
                    FROM (SELECT * FROM estreia ORDER BY giro DESC LIMIT _limite) e
                    JOIN nomeia n USING (codcli) LEFT JOIN legado_pracas lp ON lp.codigo = e.praca)
  ) INTO res;
  RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_alertas(int,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_alertas(int,int,int) TO authenticated;

-- -------------------------------------------- praça × categoria (mapa) ---
CREATE OR REPLACE FUNCTION public.legado_bi_praca_categoria(_de date DEFAULT NULL, _ate date DEFAULT NULL, _representante int DEFAULT NULL, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  RETURN coalesce((
    WITH f AS (SELECT * FROM public.legado_bi_base(_de, _ate, NULL, _representante, _data)),
    pc AS (SELECT f.praca, coalesce(nullif(c.categoria, ''), 'SEM CATEGORIA') categoria,
                  sum(c.pecas_enviadas) env, sum(c.pecas_enviadas - c.pecas_devolvidas) vend
             FROM legado_maleta_categorias c JOIN f USING (remessa, codcli, kit) GROUP BY 1, 2),
    rede AS (SELECT categoria, 100.0 * sum(vend) / nullif(sum(env), 0) giro, sum(env) env FROM pc GROUP BY 1),
    tot AS (SELECT praca, sum(env) env FROM pc GROUP BY 1)
    SELECT jsonb_build_object(
      'categorias', (SELECT jsonb_agg(categoria ORDER BY env DESC) FROM rede WHERE env >= 500),
      'giro_rede', (SELECT jsonb_object_agg(categoria, round(giro, 1)) FROM rede WHERE env >= 500),
      'linhas', (SELECT jsonb_agg(jsonb_build_object('praca', t.praca, 'praca_nome', lp.nome, 'pecas_enviadas', t.env,
                   'celulas', (SELECT jsonb_object_agg(pc.categoria, jsonb_build_object(
                                 'giro_pct', round(100.0 * pc.vend / nullif(pc.env, 0), 1),
                                 'envio_pct', round(100.0 * pc.env / nullif(t.env, 0), 1),
                                 'indice', round((100.0 * pc.vend / nullif(pc.env, 0)) / nullif(r.giro, 0), 2)))
                                 FROM pc JOIN rede r USING (categoria) WHERE pc.praca = t.praca AND r.env >= 500 AND pc.env >= 30))
                   ORDER BY lp.nome)
                   FROM tot t LEFT JOIN legado_pracas lp ON lp.codigo = t.praca WHERE t.env >= 1000))), '{}'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_praca_categoria(date,date,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_praca_categoria(date,date,int,text) TO authenticated;

-- ----------------------------------------------------------- produtos ---
CREATE OR REPLACE FUNCTION public.legado_bi_produtos(_de date DEFAULT NULL, _ate date DEFAULT NULL, _praca int DEFAULT NULL,
  _representante int DEFAULT NULL, _categoria text DEFAULT NULL, _limite int DEFAULT 20, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE fim date;
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  _limite := least(greatest(coalesce(_limite, 20), 1), 100);
  SELECT coalesce(_ate, max(fechamento)) INTO fim FROM legado_maletas;
  RETURN coalesce((
    WITH f AS (SELECT * FROM public.legado_bi_base(_de, _ate, _praca, _representante, _data)),
    v AS (SELECT mv.produto, sum(mv.quantidade) qtd, sum(mv.quantidade * mv.valor_unitario_cents) valor,
                 count(DISTINCT mv.codcli) consultoras, count(DISTINCT f.praca) pracas,
                 sum(mv.quantidade) FILTER (WHERE f.fechamento > fim - 90) qtd_90d,
                 sum(mv.quantidade) FILTER (WHERE f.fechamento <= fim - 90 AND f.fechamento > fim - 180) qtd_90d_antes
            FROM legado_maleta_vendidos mv JOIN f USING (remessa, codcli, kit) GROUP BY 1)
    SELECT jsonb_agg(jsonb_build_object('produto', v.produto, 'nome', p.nome, 'referencia', p.referencia, 'categoria', p.categoria,
             'subcategoria', p.subcategoria, 'product_id', p.product_id, 'quantidade', v.qtd, 'valor_cents', v.valor,
             'consultoras', v.consultoras, 'pracas', v.pracas, 'ultimos_90d', coalesce(v.qtd_90d, 0), 'anteriores_90d', coalesce(v.qtd_90d_antes, 0))
           ORDER BY v.qtd DESC, v.valor DESC)
      FROM (SELECT v.* FROM v JOIN legado_produtos p0 ON p0.codigo = v.produto
             WHERE _categoria IS NULL OR p0.categoria = upper(_categoria) ORDER BY v.qtd DESC, v.valor DESC LIMIT _limite) v
      JOIN legado_produtos p ON p.codigo = v.produto), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_produtos(date,date,int,int,text,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_produtos(date,date,int,int,text,int,text) TO authenticated;

-- número inteiro no formato brasileiro (1.234.567), sem depender do locale do banco
CREATE OR REPLACE FUNCTION public.legado_fmt_int(_n numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT replace(to_char(round(coalesce(_n, 0)), 'FM999,999,999,990'), ',', '.') $$;

-- ----------------------------------------------------------- insights ---
-- Frases prontas com números do recorte. Cada uma: chave, tom (alerta|oportunidade|positivo|info), titulo, texto.
CREATE OR REPLACE FUNCTION public.legado_bi_insights(_de date DEFAULT NULL, _ate date DEFAULT NULL,
                                                    _praca int DEFAULT NULL, _representante int DEFAULT NULL, _data text DEFAULT 'acerto')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p jsonb; j jsonb; a jsonb; out jsonb := '[]'::jsonb; k jsonb; x record; y record; z record; txt text;
BEGIN
  PERFORM public.legado_bi_exigir();
  IF _data NOT IN ('acerto', 'saida') THEN RAISE EXCEPTION 'Data inválida: use acerto ou saida.'; END IF;
  p := public.legado_bi_painel(_de, _ate, _praca, _representante, _data);
  j := public.legado_bi_jornada(_de, _ate, _praca, _representante, _data);
  a := public.legado_bi_alertas(_praca, _representante, 1);
  k := p->'kpis';
  IF coalesce((k->>'maletas')::int, 0) = 0 THEN RETURN out; END IF;

  -- 1. concentração
  out := out || jsonb_build_object('chave', 'pareto', 'tom', 'info', 'titulo', 'Quem faz a venda',
    'texto', format('%s%% das consultoras fazem %s%% de todo o valor vendido; metade delas faz %s%%.',
                    20, replace((p->'pareto'->>'top20_pct'), '.', ','), replace((p->'pareto'->>'top50_pct'), '.', ',')));

  -- 2. maletas zeradas
  out := out || jsonb_build_object('chave', 'zeradas', 'tom', 'alerta', 'titulo', 'Maletas que voltam sem venda',
    'texto', format('%s%% das maletas acertadas (%s) voltaram sem nenhuma peça vendida.',
                    replace(k->>'maletas_zeradas_pct', '.', ','), public.legado_fmt_int((k->>'maletas_zeradas')::numeric)));

  -- 3. zeraram duas seguidas
  IF coalesce((a->'zeraram_duas'->>'consultoras')::int, 0) > 0 THEN
    out := out || jsonb_build_object('chave', 'zeraram_duas', 'tom', 'alerta', 'titulo', 'Duas maletas seguidas sem venda',
      'texto', format('%s consultoras zeraram as duas últimas maletas; %s ainda estão com maleta na rua (%s peças).',
                      a->'zeraram_duas'->>'consultoras', a->'zeraram_duas'->>'com_maleta_na_rua',
                      public.legado_fmt_int((a->'zeraram_duas'->>'pecas_na_rua')::numeric)));
  END IF;

  -- 4. primeira maleta x seguintes
  SELECT (SELECT (e->>'giro_pct')::numeric FROM jsonb_array_elements(j->'curva') e WHERE (e->>'n')::int = 1) g1,
         (SELECT round(avg((e->>'giro_pct')::numeric), 1) FROM jsonb_array_elements(j->'curva') e WHERE (e->>'n')::int BETWEEN 2 AND 6) g26
    INTO x;
  IF x.g1 IS NOT NULL AND x.g26 IS NOT NULL THEN
    out := out || jsonb_build_object('chave', 'estreia', 'tom', CASE WHEN x.g1 > x.g26 THEN 'oportunidade' ELSE 'info' END,
      'titulo', 'A primeira maleta',
      'texto', format('Na 1ª maleta a consultora vende %s%% do que recebe; da 2ª à 6ª, %s%%. %s',
                      replace(x.g1::text, '.', ','), replace(x.g26::text, '.', ','),
                      CASE WHEN x.g1 > x.g26 THEN 'O entusiasmo do começo se perde: acompanhar a 2ª maleta de perto rende.' ELSE '' END));
  END IF;

  -- 5. mix: categoria que vende mais do que recebe e a que vende menos
  SELECT e->>'categoria' cat, (e->>'envio_pct')::numeric envio, (e->>'venda_pct')::numeric venda, (e->>'giro_pct')::numeric giro
    INTO y FROM jsonb_array_elements(p->'mix') e WHERE (e->>'envio_pct')::numeric >= 1
   ORDER BY (e->>'venda_pct')::numeric - (e->>'envio_pct')::numeric DESC LIMIT 1;
  SELECT e->>'categoria' cat, (e->>'envio_pct')::numeric envio, (e->>'venda_pct')::numeric venda, (e->>'giro_pct')::numeric giro
    INTO z FROM jsonb_array_elements(p->'mix') e WHERE (e->>'envio_pct')::numeric >= 1
   ORDER BY (e->>'venda_pct')::numeric - (e->>'envio_pct')::numeric ASC LIMIT 1;
  IF y.cat IS NOT NULL AND z.cat IS NOT NULL AND y.cat <> z.cat THEN
    out := out || jsonb_build_object('chave', 'mix', 'tom', 'oportunidade', 'titulo', 'Mix da maleta',
      'texto', format('%s são %s%% do que vai na maleta e %s%% do que vende (giro %s%%). %s: %s%% do envio e %s%% da venda (giro %s%%).',
                      initcap(y.cat), replace(y.envio::text, '.', ','), replace(y.venda::text, '.', ','), replace(y.giro::text, '.', ','),
                      initcap(z.cat), replace(z.envio::text, '.', ','), replace(z.venda::text, '.', ','), replace(z.giro::text, '.', ',')));
  END IF;

  -- 6. tendência anual (dois últimos anos com dados)
  SELECT (arr->-2->>'ano') a1, (arr->-2->>'giro_pct') g1, (arr->-1->>'ano') a2, (arr->-1->>'giro_pct') g2,
         (arr->-2->>'ticket_medio_cents')::bigint t1, (arr->-1->>'ticket_medio_cents')::bigint t2
    INTO x FROM (SELECT p->'anos' arr) s WHERE jsonb_array_length(p->'anos') >= 2;
  IF x.a1 IS NOT NULL THEN
    out := out || jsonb_build_object('chave', 'tendencia', 'tom', CASE WHEN x.g2::numeric < x.g1::numeric THEN 'alerta' ELSE 'positivo' END,
      'titulo', 'Tendência',
      'texto', format('Giro de %s%% em %s e %s%% em %s; venda média por maleta de R$ %s para R$ %s.',
                      replace(x.g1, '.', ','), x.a1, replace(x.g2, '.', ','), x.a2,
                      public.legado_fmt_int(x.t1 / 100.0), public.legado_fmt_int(x.t2 / 100.0)));
  END IF;

  -- 7. melhor mês
  SELECT (e->>'mes')::int mes, (e->>'giro_pct')::numeric giro INTO x
    FROM jsonb_array_elements(p->'sazonalidade') e ORDER BY (e->>'giro_pct')::numeric DESC LIMIT 1;
  IF x.mes IS NOT NULL THEN
    out := out || jsonb_build_object('chave', 'sazonalidade', 'tom', 'oportunidade', 'titulo', 'Melhor época',
      'texto', format('Maletas que saem em %s giram %s%% (média %s%%): é o mês para mandar maleta maior e mais peças novas.',
                      (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[x.mes],
                      replace(x.giro::text, '.', ','), replace(k->>'giro_pct', '.', ',')));
  END IF;

  -- 8. retenção depois da 1ª maleta zerada
  SELECT (e->>'recebeu_segunda_pct') pct, (e->>'giro_segunda_pct') giro, (e->>'consultoras')::int n INTO x
    FROM jsonb_array_elements(j->'primeira_maleta') e WHERE (e->>'zerada')::boolean;
  IF x.n IS NOT NULL AND x.n > 0 THEN
    out := out || jsonb_build_object('chave', 'primeira_zerada', 'tom', 'alerta', 'titulo', 'Estreia sem venda',
      'texto', format('%s consultoras não venderam nada na 1ª maleta; %s%% receberam a 2ª, que girou só %s%%.',
                      public.legado_fmt_int(x.n), replace(x.pct, '.', ','), replace(coalesce(x.giro, '0'), '.', ',')));
  END IF;

  -- 9. dias na rua
  SELECT (SELECT (e->>'giro_pct')::numeric FROM jsonb_array_elements(p->'dias_na_rua') e WHERE (e->>'faixa') IN ('35–49')) g1,
         (SELECT (e->>'giro_pct')::numeric FROM jsonb_array_elements(p->'dias_na_rua') e WHERE (e->>'faixa') IN ('65–89')) g2 INTO x;
  IF x.g1 IS NOT NULL AND x.g2 IS NOT NULL AND x.g2 < x.g1 THEN
    out := out || jsonb_build_object('chave', 'ciclo', 'tom', 'oportunidade', 'titulo', 'Tempo na rua',
      'texto', format('Maleta acertada entre 35 e 49 dias gira %s%%; a que fica 65 a 89 dias, %s%%. Mais tempo na rua não vende mais.',
                      replace(x.g1::text, '.', ','), replace(x.g2::text, '.', ',')));
  END IF;
  -- 10. quando elas param
  SELECT sum((e->>'consultoras')::int) FILTER (WHERE (e->>'n')::int <= 3) ate3, sum((e->>'consultoras')::int) tot
    INTO x FROM jsonb_array_elements(j->'parou_apos') e;
  IF coalesce(x.tot, 0) > 0 THEN
    out := out || jsonb_build_object('chave', 'parada', 'tom', 'alerta', 'titulo', 'Quando elas param',
      'texto', format('Das %s consultoras que pararam de pegar maleta, %s%% pararam até a 3ª. O risco de perder está no começo.',
                      public.legado_fmt_int(x.tot), replace(round(100.0 * x.ate3 / x.tot, 1)::text, '.', ',')));
  END IF;

  -- 11. praças: melhor e pior giro (só sem filtro de praça)
  IF _praca IS NULL THEN
    WITH pr AS (SELECT b.praca, round(100.0 * sum(b.pecas_vendidas) / sum(b.pecas_enviadas), 1) giro, count(*) n
                  FROM public.legado_bi_base(_de, _ate, NULL, _representante, _data) b GROUP BY 1 HAVING count(*) >= 100)
    SELECT (SELECT lp.nome FROM pr JOIN legado_pracas lp ON lp.codigo = pr.praca ORDER BY giro DESC LIMIT 1) melhor,
           (SELECT giro FROM pr ORDER BY giro DESC LIMIT 1) g_melhor,
           (SELECT lp.nome FROM pr JOIN legado_pracas lp ON lp.codigo = pr.praca ORDER BY giro ASC LIMIT 1) pior,
           (SELECT giro FROM pr ORDER BY giro ASC LIMIT 1) g_pior
      INTO y;
    IF y.melhor IS NOT NULL AND y.pior IS NOT NULL AND y.melhor <> y.pior THEN
      out := out || jsonb_build_object('chave', 'pracas', 'tom', 'info', 'titulo', 'Praças',
        'texto', format('%s gira %s%%; %s, %s%%. Mesma coleção, resultado diferente: vale levar o jeito da primeira para a segunda.',
                        initcap(y.melhor), replace(y.g_melhor::text, '.', ','), initcap(y.pior), replace(y.g_pior::text, '.', ',')));
    END IF;
  END IF;
  RETURN out;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_insights(date,date,int,int,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_insights(date,date,int,int,text) TO authenticated;

-- Representantes para o filtro do BI (código e nome).
CREATE OR REPLACE FUNCTION public.legado_bi_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  PERFORM public.legado_bi_exigir();
  RETURN jsonb_build_object(
    'pracas', (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome) ORDER BY p.nome), '[]')
                 FROM legado_pracas p WHERE EXISTS (SELECT 1 FROM legado_remessas r WHERE r.praca = p.codigo)),
    'representantes', (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', r.codigo, 'nome', coalesce(r.nome, 'Representante ' || r.codigo)) ORDER BY r.nome), '[]')
                 FROM legado_representantes r WHERE EXISTS (SELECT 1 FROM legado_remessas x WHERE x.representante = r.codigo)),
    'periodo', (SELECT jsonb_build_object('de', min(emissao), 'ate', max(emissao)) FROM legado_maletas));
END $fn$;
REVOKE ALL ON FUNCTION public.legado_bi_opcoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legado_bi_opcoes() TO authenticated;
-- 0125 — Venda do mês = cobrança do acerto (igual ao relatório "Total de acertos" do SmallData).
--
-- O que estava errado
--   O valor e a data do acerto vinham da tabela de fechamento da maleta (T_REM_CLIENTE).
--   O SmallData soma a venda do mês pela COBRANÇA do acerto (T_GF_COBRANCA: "Vlr. Bruto"
--   na "Data Cob."). Os dois coincidem na maioria dos acertos, mas não em todos:
--     • cobrança lançada em dia diferente do fechamento (às vezes no mês seguinte);
--     • valor cobrado diferente do valor do fechamento (cobrança de atraso, ajustes);
--     • maleta fechada sem cobrança nenhuma (não entra na venda do SmallData);
--     • cobrança de maleta que no fechamento ainda aparecia aberta.
--   Por isso fevereiro e agosto/2026 batiam e outros meses ficavam R$ 500 a R$ 22 mil fora.
--
-- O que muda (nada é apagado, nenhuma coluna removida)
--   1. legado_acertos_consultora ganha "fonte". As linhas que já existem ficam marcadas
--      'remessa_cliente' (a fonte antiga). Tudo o que for importado daqui para frente
--      (o novo acertos_consultora.csv, tirado do relatório de cobrança) fica 'cobranca'.
--   2. Assim que existir acerto da fonte 'cobranca', só ele vale:
--      • a maleta recebe a parte dela no valor cobrado e a DATA DA COBRANÇA vira a data do
--        acerto (a data original do fechamento fica guardada em fechamento_smalldata);
--      • maleta fechada sem cobrança fica com venda zero e sem_cobranca = true;
--      • as linhas antigas continuam na tabela, só deixam de ser usadas.
--      Antes da nova importação nada muda.
--   3. Os totais do BI (cartões e anos) passam a incluir as contas internas da Lardan,
--      como o SmallData. Rankings, jornada e alertas continuam sem elas.
--
-- Reversível: basta apagar as linhas com fonte = 'cobranca' e rodar
--   select public.legado_acertos_distribuir(null);
-- que tudo volta ao cálculo anterior (a data original volta de fechamento_smalldata).

-- ------------------------------------------------------------- 1. fonte ---
DO $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'legado_acertos_consultora' AND column_name = 'fonte') THEN
    ALTER TABLE public.legado_acertos_consultora ADD COLUMN fonte text NOT NULL DEFAULT 'remessa_cliente';
    ALTER TABLE public.legado_acertos_consultora ALTER COLUMN fonte SET DEFAULT 'cobranca';
  END IF;
END $f$;
COMMENT ON COLUMN public.legado_acertos_consultora.fonte IS
  'cobranca = relatório de cobrança do SmallData (vale); remessa_cliente = fechamento da maleta (fonte antiga, ignorada quando há cobrança).';

-- reimportar uma linha (o importador atualiza atualizado_em) também a marca como cobrança
CREATE OR REPLACE FUNCTION public.legado_acertos_marcar_fonte()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.atualizado_em IS DISTINCT FROM OLD.atualizado_em THEN NEW.fonte := 'cobranca'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS legado_acertos_marcar_fonte ON public.legado_acertos_consultora;
CREATE TRIGGER legado_acertos_marcar_fonte BEFORE UPDATE ON public.legado_acertos_consultora
  FOR EACH ROW EXECUTE FUNCTION public.legado_acertos_marcar_fonte();

-- ------------------------------------------------- 2. colunas na maleta ---
ALTER TABLE public.legado_maletas ADD COLUMN IF NOT EXISTS fechamento_smalldata date;
ALTER TABLE public.legado_maletas ADD COLUMN IF NOT EXISTS sem_cobranca boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.legado_maletas.fechamento_smalldata IS
  'Data de fechamento original do SmallData, guardada quando a data da cobrança do acerto passa a ser a data do acerto.';
COMMENT ON COLUMN public.legado_maletas.sem_cobranca IS
  'Maleta fechada no SmallData sem cobrança de acerto: não entra na venda (igual ao relatório de acertos do SmallData).';

-- --------------------------------------------- 3. repartição do acerto ---
-- _chaves: [[remessa, codcli], ...]; null = todas as maletas.
CREATE OR REPLACE FUNCTION public.legado_acertos_distribuir(_chaves jsonb)
RETURNS int LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE n int; modo boolean;
BEGIN
  modo := EXISTS (SELECT 1 FROM legado_acertos_consultora WHERE fonte = 'cobranca');
  PERFORM set_config('lardan.distribuindo', 'on', true);   -- o gatilho da maleta não reage a esta própria escrita
  WITH ch AS (SELECT DISTINCT (c->>0)::int remessa, (c->>1)::int codcli FROM jsonb_array_elements(coalesce(_chaves, '[]')) c),
  a AS (SELECT ac.remessa, ac.codcli, ac.valor_cents, ac.data FROM legado_acertos_consultora ac
         WHERE ac.fonte = 'cobranca' OR NOT modo),
  k AS (SELECT m.remessa, m.codcli, m.kit, m.valor_acerto_cents atual, m.sem_cobranca sem_antes, m.fechamento, m.fechamento_smalldata,
               coalesce(m.fechamento_smalldata, m.fechamento) original,
               a.remessa IS NOT NULL tem, a.valor_cents, a.data,
               greatest(m.valor_enviado_cents - m.valor_devolvido_cents, 0) base,
               row_number() OVER (PARTITION BY m.remessa, m.codcli ORDER BY m.kit) rn,
               sum(greatest(m.valor_enviado_cents - m.valor_devolvido_cents, 0)) OVER (PARTITION BY m.remessa, m.codcli) tot
          FROM legado_maletas m
          LEFT JOIN a ON a.remessa = m.remessa AND a.codcli = m.codcli
          WHERE _chaves IS NULL OR EXISTS (SELECT 1 FROM ch WHERE ch.remessa = m.remessa AND ch.codcli = m.codcli)),
  s AS (SELECT k.*, CASE WHEN k.tem AND k.tot > 0 THEN floor(k.valor_cents::numeric * k.base / k.tot)::bigint ELSE 0 END parte FROM k),
  f AS (SELECT s.remessa, s.codcli, s.kit,
               CASE WHEN s.tem THEN
                      CASE WHEN s.rn = 1 THEN s.valor_cents - (sum(s.parte) OVER (PARTITION BY s.remessa, s.codcli) - s.parte) ELSE s.parte END
                    WHEN modo AND s.original IS NOT NULL THEN 0
                    WHEN s.sem_antes THEN NULL          -- deixou de haver cobrança: volta ao cálculo pelas peças
                    ELSE s.atual END valor,
               s.tem AND abs(s.valor_cents - s.tot) > 100 divergente,
               (NOT s.tem) AND modo AND s.original IS NOT NULL sem,
               CASE WHEN modo AND s.tem AND s.data IS NOT NULL THEN s.data ELSE s.original END fech,
               CASE WHEN modo AND s.tem AND s.data IS NOT NULL AND s.data IS DISTINCT FROM s.original THEN s.original END fech_orig
          FROM s)
  UPDATE legado_maletas m
     SET valor_acerto_cents = f.valor, acerto_divergente = f.divergente, sem_cobranca = f.sem,
         fechamento = f.fech, fechamento_smalldata = f.fech_orig
    FROM f
   WHERE m.remessa = f.remessa AND m.codcli = f.codcli AND m.kit = f.kit
     AND (m.valor_acerto_cents IS DISTINCT FROM f.valor OR m.acerto_divergente IS DISTINCT FROM f.divergente
          OR m.sem_cobranca IS DISTINCT FROM f.sem OR m.fechamento IS DISTINCT FROM f.fech
          OR m.fechamento_smalldata IS DISTINCT FROM f.fech_orig);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('lardan.distribuindo', '', true);
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_acertos_distribuir(jsonb) FROM PUBLIC, anon, authenticated;

-- Acertos importados: com a fonte de cobrança, toda maleta é recalculada (as que ficaram
-- sem cobrança também precisam zerar). Sem ela, só as chaves do lote, como antes.
CREATE OR REPLACE FUNCTION public.legado_acertos_aplicar()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM novas WHERE fonte = 'cobranca') THEN
    PERFORM public.legado_acertos_distribuir(NULL);
  ELSE
    PERFORM public.legado_acertos_distribuir((SELECT jsonb_agg(jsonb_build_array(remessa, codcli)) FROM novas));
  END IF;
  RETURN NULL;
END $fn$;

-- Maleta reimportada com outra data de fechamento: a data nova do SmallData passa a ser a
-- original guardada; depois a data da cobrança é reaplicada. Outras atualizações da maleta
-- não mexem na data original.
CREATE OR REPLACE FUNCTION public.legado_maletas_aplicar_acerto_upd()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('lardan.distribuindo', true) = 'on' THEN RETURN NULL; END IF;
  UPDATE legado_maletas m SET fechamento_smalldata = NULL
    FROM novas n JOIN antigas o ON o.remessa = n.remessa AND o.codcli = n.codcli AND o.kit = n.kit
   WHERE m.remessa = n.remessa AND m.codcli = n.codcli AND m.kit = n.kit
     AND n.fechamento IS DISTINCT FROM o.fechamento AND m.fechamento_smalldata IS NOT NULL;
  PERFORM public.legado_acertos_distribuir((SELECT jsonb_agg(DISTINCT jsonb_build_array(remessa, codcli)) FROM novas));
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.legado_maletas_aplicar_acerto_upd() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS legado_maletas_aplicar_acerto_upd ON public.legado_maletas;
CREATE TRIGGER legado_maletas_aplicar_acerto_upd AFTER UPDATE ON public.legado_maletas
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.legado_maletas_aplicar_acerto_upd();

-- ----------------------------------- 4. totais do BI com as contas internas ---
DO $bi$
DECLARE def text; novo text;
BEGIN
  -- base de totais: igual à base do BI, sem excluir as contas internas
  def := pg_get_functiondef('public.legado_bi_base(date,date,integer,integer,text)'::regprocedure);
  novo := replace(def, 'FUNCTION public.legado_bi_base(', 'FUNCTION public.legado_bi_base_total(');
  novo := replace(novo, ' AND NOT coalesce(lc.interna, false)', '');
  IF novo = def OR position('interna' IN novo) > 0 THEN RAISE EXCEPTION 'legado_bi_base não tem o formato esperado.'; END IF;
  EXECUTE novo;

  -- cartões (kpis) somam pela base de totais
  def := pg_get_functiondef('public.legado_bi_kpis(date,date,integer,integer,text)'::regprocedure);
  IF position('legado_bi_base_total(' IN def) = 0 THEN
    novo := replace(def, 'public.legado_bi_base(', 'public.legado_bi_base_total(');
    IF novo = def THEN RAISE EXCEPTION 'legado_bi_kpis não tem o formato esperado.'; END IF;
    EXECUTE novo;
  END IF;

  -- painel: o bloco "anos" (venda por ano) também soma pela base de totais
  def := pg_get_functiondef('public.legado_bi_painel(date,date,integer,integer,text)'::regprocedure);
  IF position('legado_bi_base_total(' IN def) = 0 THEN
    IF (length(def) - length(replace(def, 'FROM f WHERE data_ref IS NOT NULL GROUP BY 1) x)', ''))) <> length('FROM f WHERE data_ref IS NOT NULL GROUP BY 1) x)') THEN
      RAISE EXCEPTION 'legado_bi_painel não tem o formato esperado.';
    END IF;
    novo := replace(def, 'FROM f WHERE data_ref IS NOT NULL GROUP BY 1) x)',
      'FROM public.legado_bi_base_total(_de, _ate, _praca, _representante, _data) WHERE data_ref IS NOT NULL GROUP BY 1) x)');
    EXECUTE novo;
  END IF;
END $bi$;
REVOKE ALL ON FUNCTION public.legado_bi_base_total(date,date,integer,integer,text) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------- 5. recálculo único ---
-- Sem acertos de cobrança ainda, nada muda; com eles (reaplicação), tudo fica coerente.
SELECT public.legado_acertos_distribuir(NULL);

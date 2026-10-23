-- 0126 — Banho no material bruto, custo pelo banho e reclassificação de banho e categoria pela descrição.
--
-- 1. Produto ganha: tipo de banho, camada, valor do banho por grama (custo, protegido) e
--    custo_pelo_banho. Para cadastro novo (ou produto ainda sem custo):
--        preço de custo = peso bruto (g) × valor do banho por grama + valor da peça no bruto
--    Produto que JÁ tem preço de custo não muda (custo_pelo_banho = false).
-- 2. produto_classificar_nome: lê a descrição (DOU, PR, PR925, RODIO, AÇO/INOX; BR, GR, AN, PUL,
--    TN, BC, PG, CJ...) e devolve banho e categoria sugeridos. Não grava nada.
-- 3. produto_reclassificar(_aplicar): prévia por padrão; com _aplicar = true preenche o banho e a
--    categoria só onde estão vazios (divergências só com _corrigir_divergentes), registra cada
--    mudança em produto_reclassificacao e pode ser desfeita por lote.
-- Nada é apagado; nenhuma coluna removida; custos existentes não são tocados.

-- ------------------------------------------------------------- 1. colunas ---
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS banho_tipo text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS banho_camada smallint;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS banho_valor_grama_cents integer;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS custo_pelo_banho boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS banho_origem text;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_banho_tipo_valido;
ALTER TABLE public.products ADD CONSTRAINT products_banho_tipo_valido
  CHECK (banho_tipo IS NULL OR banho_tipo IN ('dourado', 'rodio_branco', 'prata_banhada', 'prata_925', 'aco_inox'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_banho_camada_valida;
ALTER TABLE public.products ADD CONSTRAINT products_banho_camada_valida CHECK (
  banho_camada IS NULL
  OR (banho_tipo = 'dourado' AND banho_camada IN (1, 2, 3, 5, 7))
  OR (banho_tipo = 'prata_banhada' AND banho_camada IN (30, 70)));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_banho_valor_nonneg;
ALTER TABLE public.products ADD CONSTRAINT products_banho_valor_nonneg CHECK (banho_valor_grama_cents IS NULL OR banho_valor_grama_cents >= 0);
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_banho_origem_valida;
ALTER TABLE public.products ADD CONSTRAINT products_banho_origem_valida CHECK (banho_origem IS NULL OR banho_origem IN ('cadastro', 'descricao'));

COMMENT ON COLUMN public.products.banho_tipo IS 'dourado | rodio_branco | prata_banhada | prata_925 | aco_inox';
COMMENT ON COLUMN public.products.banho_camada IS 'Dourado: 1, 2, 3, 5 ou 7. Prata banhada: 30 ou 70. Demais: vazio.';
COMMENT ON COLUMN public.products.banho_valor_grama_cents IS 'Custo do banho por grama (centavos). Só leitura autorizada (product_costs_read).';
COMMENT ON COLUMN public.products.custo_pelo_banho IS 'Preço de custo calculado: peso bruto × banho por grama + peça no bruto. Produtos que já tinham custo ficam false e não mudam.';

-- leitura: tipo, camada e origem são públicos para a equipe; o valor do banho é custo (não entra)
GRANT SELECT (banho_tipo, banho_camada, custo_pelo_banho, banho_origem) ON public.products TO authenticated;

-- ------------------------------------------------- 2. custo pelo banho ---
CREATE OR REPLACE FUNCTION public.products_custo_pelo_banho()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE pode boolean;
BEGIN
  -- camada só faz sentido para dourado e prata banhada
  IF NEW.banho_tipo IS NULL OR NEW.banho_tipo NOT IN ('dourado', 'prata_banhada') THEN NEW.banho_camada := NULL; END IF;

  pode := NEW.custo_pelo_banho
          OR (TG_OP = 'INSERT' AND NEW.cost_price_cents IS NULL)
          OR (TG_OP = 'UPDATE' AND OLD.cost_price_cents IS NULL AND NOT OLD.custo_pelo_banho);
  IF pode AND NEW.raw_weight_grams IS NOT NULL AND NEW.banho_valor_grama_cents IS NOT NULL AND NEW.raw_piece_cost_cents IS NOT NULL THEN
    NEW.cost_price_cents := round(NEW.raw_weight_grams * NEW.banho_valor_grama_cents)::integer + NEW.raw_piece_cost_cents;
    NEW.custo_pelo_banho := true;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_products_custo_pelo_banho ON public.products;
CREATE TRIGGER trg_products_custo_pelo_banho BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_custo_pelo_banho();

-- grava banho, camada e valor do banho (o valor só para quem vê custos)
CREATE OR REPLACE FUNCTION public.product_banho_salvar(_product uuid, _tipo text, _camada integer, _valor_grama_cents integer DEFAULT NULL,
                                                        _alterar_valor boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE p products;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'product.manage') THEN
    RAISE EXCEPTION 'Somente o perfil Master pode criar ou editar produtos.' USING errcode = '42501';
  END IF;
  IF _alterar_valor AND NOT public.can_view_costs(auth.uid()) THEN
    RAISE EXCEPTION 'Seu perfil não tem permissão para alterar custos.' USING errcode = '42501';
  END IF;
  _tipo := nullif(btrim(coalesce(_tipo, '')), '');
  IF _tipo IS NOT NULL AND _tipo NOT IN ('dourado', 'rodio_branco', 'prata_banhada', 'prata_925', 'aco_inox') THEN
    RAISE EXCEPTION 'Tipo de banho inválido.' USING errcode = '23514';
  END IF;
  IF _camada IS NOT NULL AND NOT ((_tipo = 'dourado' AND _camada IN (1, 2, 3, 5, 7)) OR (_tipo = 'prata_banhada' AND _camada IN (30, 70))) THEN
    RAISE EXCEPTION 'Camada inválida para este banho (dourado: 1, 2, 3, 5 ou 7; prata banhada: 30 ou 70).' USING errcode = '23514';
  END IF;
  IF _alterar_valor AND _valor_grama_cents IS NOT NULL AND _valor_grama_cents < 0 THEN
    RAISE EXCEPTION 'O valor do banho não pode ser negativo.' USING errcode = '23514';
  END IF;

  UPDATE products SET banho_tipo = _tipo, banho_camada = _camada,
         banho_valor_grama_cents = CASE WHEN _alterar_valor THEN _valor_grama_cents ELSE banho_valor_grama_cents END,
         banho_origem = CASE WHEN _tipo IS NULL THEN NULL
                             WHEN _tipo IS DISTINCT FROM banho_tipo THEN 'cadastro' ELSE banho_origem END,
         updated_at = now()
   WHERE id = _product
  RETURNING * INTO p;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.' USING errcode = 'P0002'; END IF;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'catalogo.produto.banho', 'products', p.id::text,
          jsonb_build_object('tipo', p.banho_tipo, 'camada', p.banho_camada, 'valor_alterado', _alterar_valor, 'custo_pelo_banho', p.custo_pelo_banho));
  RETURN jsonb_build_object('banho_tipo', p.banho_tipo, 'banho_camada', p.banho_camada, 'custo_pelo_banho', p.custo_pelo_banho,
                            'cost_price_cents', CASE WHEN public.can_view_costs(auth.uid()) THEN p.cost_price_cents END);
END $fn$;
REVOKE ALL ON FUNCTION public.product_banho_salvar(uuid, text, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_banho_salvar(uuid, text, integer, integer, boolean) TO authenticated;

-- a leitura de custos passa a trazer o valor do banho e se o custo é calculado
DO $c$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.product_costs_read(uuid)'::regprocedure);
  IF position('banho_valor_grama_cents' IN def) > 0 THEN RETURN; END IF;
  novo := replace(def, $q$'markup_percent', p.markup_percent)$q$,
    $q$'markup_percent', p.markup_percent,
      'banho_valor_grama_cents', p.banho_valor_grama_cents,
      'custo_pelo_banho', p.custo_pelo_banho)$q$);
  IF novo = def THEN RAISE EXCEPTION 'product_costs_read não tem o formato esperado.'; END IF;
  EXECUTE novo;
END $c$;

-- ------------------------------------------------ 3. classificador ---
-- Lê a descrição (nome) do produto e sugere banho e categoria. Puro: não lê nem grava tabela.
CREATE OR REPLACE FUNCTION public.produto_classificar_nome(_nome text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $fn$
DECLARE
  n text := upper(translate(coalesce(_nome, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                                  'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
  t text[];
  b_aco boolean; b_925 boolean; b_rodio boolean; b_negro boolean; b_dou boolean; b_pr boolean;
  banho text; banho_regra text; cat text; cat_regra text; tok text; i int;
BEGIN
  -- "PROMOÇÃOBRINCO" e afins: separa a palavra promoção grudada
  n := regexp_replace(n, '^(PROMOCAO|PRMOCAO)(?=[A-Z])', '\1 ');
  n := regexp_replace(n, '^PROMOCA(?=[A-NP-Z])', 'PROMOCA ');
  t := array_remove(regexp_split_to_array(n, '[^A-Z0-9]+'), '');

  -- ---------------------------------------------------------------- banho ---
  b_aco   := 'ACO' = ANY (t) OR 'INOX' = ANY (t);                 -- só a palavra AÇO inteira (LAÇO, TRAÇOS não contam)
  b_925   := 'PR925' = ANY (t) OR '925' = ANY (t);
  b_rodio := 'RODIO' = ANY (t) OR 'RHODIO' = ANY (t);
  b_negro := n ~ '\mRODIO\s+NEGRO\M';
  b_dou   := t && ARRAY['DOU', 'DOUR', 'DOURADO', 'DOURADA', 'DOURADOS', 'DOURADAS'];
  b_pr    := t && ARRAY['PR', 'PRATA', 'PRATEADO', 'PRATEADA', 'PRATEADOS', 'PRATEADAS'];

  IF b_aco THEN banho := 'aco_inox'; banho_regra := 'AÇO/INOX';
  ELSIF b_925 THEN banho := 'prata_925'; banho_regra := 'PR925/925';
  ELSIF b_negro AND NOT b_dou AND NOT b_pr THEN banho := NULL; banho_regra := 'ródio negro (fora da lista)';
  ELSIF (b_dou::int + b_rodio::int + b_pr::int) = 1 THEN
    banho := CASE WHEN b_dou THEN 'dourado' WHEN b_rodio THEN 'rodio_branco' ELSE 'prata_banhada' END;
    banho_regra := CASE WHEN b_dou THEN 'DOU/DOURADO' WHEN b_rodio THEN 'RODIO' ELSE 'PR/PRATA' END;
  ELSIF (b_dou::int + b_rodio::int + b_pr::int) > 1 THEN banho := NULL; banho_regra := 'mais de um banho na descrição';
  ELSE banho := NULL; banho_regra := NULL;
  END IF;

  -- ------------------------------------------------------------ categoria ---
  -- 1º: a sigla ou palavra do começo (pulando "promoção"); 2º: a palavra inteira em qualquer lugar
  FOR i IN 1 .. coalesce(array_length(t, 1), 0) LOOP
    tok := t[i];
    -- pula promoção, tamanho e o próprio banho ("DOU ARGOLA ...", "PROMOÇÃO BR PR ...")
    CONTINUE WHEN tok IN ('PROMOCAO', 'PROMOCA', 'PRMOCAO', 'PROMO', 'MINI', 'MAXI', 'INF', 'INFANTIL', 'KIT',
                          'DOU', 'DOUR', 'DOURADO', 'DOURADA', 'PR', 'PRATA', 'PR925', '925', 'RODIO', 'ACO', 'INOX');
    cat := CASE
      WHEN tok IN ('BR', 'BRINCO', 'BRINCOS', 'BRINC', 'BRINCOU', 'ARGOLA', 'ARGOLAS', 'ARGORA', 'ARGOL', 'TRIO') THEN 'brinco'
      WHEN tok IN ('GR', 'RG', 'COLAR', 'COLARES', 'GARGANTILHA', 'GARGANTILHAS', 'GARGATILHA', 'GARTGANTILHA', 'GARGATNILHA',
                   'CORRENTE', 'CORDAO', 'TERCO', 'CHOKER', 'CHOCKER', 'ESCAPULARIO', 'ES') THEN 'colar'
      WHEN tok IN ('AN', 'ANEL', 'ANEIS', 'APARADOR') THEN 'anel'
      WHEN tok IN ('PUL', 'PU', 'PULSEIRA', 'PULSEIRAS', 'PULSERIA') THEN 'pulseira'
      WHEN tok IN ('TN', 'TORNOZELEIRA', 'TORNOZELEIRAS') THEN 'tornozeleira'
      WHEN tok IN ('BC', 'BRACELETE', 'BRACELETES') THEN 'bracelete'
      WHEN tok IN ('PG', 'PING', 'PINGENTE', 'PINGENTES') THEN 'pingente'
      WHEN tok IN ('CJ', 'CJS', 'CON', 'CONJ', 'CONUNTO', 'CONJUNTO', 'CONJUNTOS') THEN 'conjunto'
      WHEN tok IN ('PC', 'PIERCING', 'PIERCINGS') THEN 'piercing'
      WHEN tok IN ('BQ', 'BERLOQUE', 'BERLOQUES') THEN 'berloque'
      WHEN tok IN ('BROCHE', 'BROCHES') THEN 'broche'
    END;
    cat_regra := CASE WHEN cat IS NOT NULL THEN 'início: ' || tok END;
    EXIT;   -- só a primeira palavra útil
  END LOOP;
  IF cat IS NULL THEN
    cat := CASE
      WHEN t && ARRAY['BRINCO', 'BRINCOS'] THEN 'brinco'
      WHEN t && ARRAY['TORNOZELEIRA', 'TORNOZELEIRAS'] THEN 'tornozeleira'
      WHEN t && ARRAY['BRACELETE', 'BRACELETES'] THEN 'bracelete'
      WHEN t && ARRAY['PULSEIRA', 'PULSEIRAS'] THEN 'pulseira'
      WHEN t && ARRAY['ANEL', 'ANEIS'] THEN 'anel'
      WHEN t && ARRAY['COLAR', 'COLARES', 'GARGANTILHA', 'GARGANTILHAS', 'CHOKER'] THEN 'colar'
      WHEN t && ARRAY['ARGOLA', 'ARGOLAS'] THEN 'brinco'
    END;
    cat_regra := CASE WHEN cat IS NOT NULL THEN 'palavra na descrição' END;
  END IF;

  RETURN jsonb_build_object('banho', banho, 'banho_regra', banho_regra, 'categoria', cat, 'categoria_regra', cat_regra);
END $fn$;
REVOKE ALL ON FUNCTION public.produto_classificar_nome(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produto_classificar_nome(text) TO authenticated;

-- ----------------------------------------- 4. reclassificação registrada ---
CREATE TABLE IF NOT EXISTS public.produto_reclassificacao (
  id bigserial PRIMARY KEY,
  lote text NOT NULL,
  product_id uuid,
  category_id uuid,
  campo text NOT NULL CHECK (campo IN ('banho_tipo', 'category_id', 'subcategory_id', 'categoria_criada')),
  antes text,
  depois text,
  regra text,
  autor uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_em timestamptz
);
CREATE INDEX IF NOT EXISTS produto_reclassificacao_lote_idx ON public.produto_reclassificacao (lote);
ALTER TABLE public.produto_reclassificacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.produto_reclassificacao FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.produto_reclassificacao TO service_role;

-- categoria raiz do Lardan que corresponde à chave (pelo nome, sem acento, singular ou plural)
CREATE OR REPLACE FUNCTION public.produto_categoria_da_chave(_chave text)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $fn$
  WITH nomes(chave, nome) AS (VALUES
    ('brinco', 'BRINCO'), ('brinco', 'BRINCOS'),
    ('colar', 'COLAR'), ('colar', 'COLARES'), ('colar', 'GARGANTILHA'), ('colar', 'GARGANTILHAS'),
    ('anel', 'ANEL'), ('anel', 'ANEIS'),
    ('pulseira', 'PULSEIRA'), ('pulseira', 'PULSEIRAS'),
    ('tornozeleira', 'TORNOZELEIRA'), ('tornozeleira', 'TORNOZELEIRAS'),
    ('bracelete', 'BRACELETE'), ('bracelete', 'BRACELETES'),
    ('pingente', 'PINGENTE'), ('pingente', 'PINGENTES'),
    ('conjunto', 'CONJUNTO'), ('conjunto', 'CONJUNTOS'),
    ('piercing', 'PIERCING'), ('piercing', 'PIERCINGS'),
    ('berloque', 'BERLOQUE'), ('berloque', 'BERLOQUES'),
    ('broche', 'BROCHE'), ('broche', 'BROCHES'))
  SELECT c.id FROM categories c JOIN nomes n ON n.chave = _chave
   WHERE c.parent_id IS NULL
     AND upper(btrim(translate(c.name, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                       'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))) = n.nome
   ORDER BY c.status = 'publicado' DESC, c.created_at
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.produto_categoria_da_chave(text) FROM PUBLIC, anon, authenticated;

-- Prévia (padrão) ou aplicação. Só preenche o que está vazio; divergências só com _corrigir_divergentes.
CREATE OR REPLACE FUNCTION public.produto_reclassificar(_aplicar boolean DEFAULT false, _corrigir_divergentes boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  lote text := 'reclass-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS');
  uid uuid := auth.uid();
  nomes_cat jsonb := '{"brinco":"Brinco","colar":"Colar","anel":"Anel","pulseira":"Pulseira","tornozeleira":"Tornozeleira",
                       "bracelete":"Bracelete","pingente":"Pingente","conjunto":"Conjunto","piercing":"Piercing",
                       "berloque":"Berloque","broche":"Broche"}';
  k text; cid uuid; v_slug text; abrev text; criadas jsonb := '[]'; res jsonb;
  n_banho int := 0; n_cat int := 0; n_div int := 0; n_sub int := 0;
BEGIN
  IF uid IS NOT NULL AND NOT (public.has_role(uid, 'master') AND public.has_capability(uid, 'product.manage')) THEN
    RAISE EXCEPTION 'Reclassificar o catálogo é só para o Master.' USING errcode = '42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _rc (id uuid PRIMARY KEY, nome text, banho_atual text, cat_atual uuid, sub_atual uuid,
    status text, banho text, banho_regra text, chave text, cat_regra text, cat_sugerida uuid) ON COMMIT DROP;
  TRUNCATE _rc;
  INSERT INTO _rc
  SELECT p.id, p.name, p.banho_tipo, p.category_id, p.subcategory_id, p.status::text,
         c->>'banho', c->>'banho_regra', c->>'categoria', c->>'categoria_regra', public.produto_categoria_da_chave(c->>'categoria')
    FROM products p, LATERAL public.produto_classificar_nome(p.name) c;

  IF _aplicar THEN
    -- categorias que faltam: criadas como rascunho (fora do site até o Master publicar)
    FOR k IN SELECT DISTINCT chave FROM _rc WHERE chave IS NOT NULL AND cat_sugerida IS NULL AND (cat_atual IS NULL OR _corrigir_divergentes) LOOP
      v_slug := k;
      WHILE EXISTS (SELECT 1 FROM categories WHERE categories.slug = v_slug) LOOP v_slug := k || '-' || substr(md5(random()::text), 1, 4); END LOOP;
      abrev := upper(left(translate(nomes_cat->>k, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), 3));
      IF EXISTS (SELECT 1 FROM categories WHERE upper(code_abbrev) = abrev) THEN abrev := NULL; END IF;
      INSERT INTO categories (name, slug, status, code_abbrev, created_by)
      VALUES (nomes_cat->>k, v_slug, 'rascunho', abrev, uid) RETURNING id INTO cid;
      UPDATE _rc SET cat_sugerida = cid WHERE chave = k;
      INSERT INTO produto_reclassificacao (lote, category_id, campo, depois, regra, autor) VALUES (lote, cid, 'categoria_criada', nomes_cat->>k, k, uid);
      criadas := criadas || jsonb_build_object('categoria', nomes_cat->>k, 'chave', k);
    END LOOP;

    -- banho: só onde está vazio
    INSERT INTO produto_reclassificacao (lote, product_id, campo, antes, depois, regra, autor)
    SELECT lote, id, 'banho_tipo', NULL, banho, banho_regra, uid FROM _rc WHERE banho IS NOT NULL AND banho_atual IS NULL;
    UPDATE products p SET banho_tipo = r.banho, banho_origem = 'descricao', updated_at = now()
      FROM _rc r WHERE r.id = p.id AND r.banho IS NOT NULL AND r.banho_atual IS NULL AND p.banho_tipo IS NULL;
    GET DIAGNOSTICS n_banho = ROW_COUNT;

    -- categoria: vazia sempre; divergente só se pedido
    INSERT INTO produto_reclassificacao (lote, product_id, campo, antes, depois, regra, autor)
    SELECT lote, id, 'category_id', cat_atual::text, cat_sugerida::text, cat_regra, uid FROM _rc
     WHERE cat_sugerida IS NOT NULL AND (cat_atual IS NULL OR (_corrigir_divergentes AND cat_atual <> cat_sugerida));
    -- subcategoria que não pertence à nova categoria fica vazia
    INSERT INTO produto_reclassificacao (lote, product_id, campo, antes, depois, regra, autor)
    SELECT lote, r.id, 'subcategory_id', r.sub_atual::text, NULL, 'subcategoria de outra categoria', uid FROM _rc r
     WHERE r.cat_sugerida IS NOT NULL AND (r.cat_atual IS NULL OR (_corrigir_divergentes AND r.cat_atual <> r.cat_sugerida))
       AND r.sub_atual IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories s WHERE s.id = r.sub_atual AND s.parent_id = r.cat_sugerida);
    GET DIAGNOSTICS n_sub = ROW_COUNT;
    UPDATE products p SET category_id = r.cat_sugerida,
           subcategory_id = CASE WHEN EXISTS (SELECT 1 FROM categories s WHERE s.id = p.subcategory_id AND s.parent_id = r.cat_sugerida)
                                 THEN p.subcategory_id END,
           updated_at = now()
      FROM _rc r WHERE r.id = p.id AND r.cat_sugerida IS NOT NULL
       AND (p.category_id IS NULL OR (_corrigir_divergentes AND p.category_id <> r.cat_sugerida));
    GET DIAGNOSTICS n_cat = ROW_COUNT;

    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'catalogo.reclassificacao', 'products', lote,
            jsonb_build_object('banho', n_banho, 'categoria', n_cat, 'subcategoria_limpa', n_sub, 'categorias_criadas', criadas,
                               'corrigir_divergentes', _corrigir_divergentes));
  END IF;

  SELECT jsonb_build_object(
    'aplicado', _aplicar, 'lote', CASE WHEN _aplicar THEN lote END,
    'produtos', (SELECT count(*) FROM _rc),
    'banho', jsonb_build_object(
       'por_tipo', (SELECT coalesce(jsonb_object_agg(b, n), '{}') FROM (SELECT banho b, count(*) n FROM _rc WHERE banho IS NOT NULL AND banho_atual IS NULL GROUP BY 1) x),
       'ja_preenchido', (SELECT count(*) FROM _rc WHERE banho_atual IS NOT NULL),
       'sem_banho_na_descricao', (SELECT count(*) FROM _rc WHERE banho IS NULL AND banho_regra IS NULL AND banho_atual IS NULL),
       'nao_decidido', (SELECT coalesce(jsonb_object_agg(rg, n), '{}') FROM (SELECT banho_regra rg, count(*) n FROM _rc WHERE banho IS NULL AND banho_regra IS NOT NULL AND banho_atual IS NULL GROUP BY 1) x),
       'amostra_nao_decidido', (SELECT coalesce(jsonb_agg(jsonb_build_object('produto', nome, 'motivo', banho_regra)), '[]')
                                  FROM (SELECT nome, banho_regra FROM _rc WHERE banho IS NULL AND banho_regra IS NOT NULL AND banho_atual IS NULL ORDER BY nome LIMIT 30) x),
       'aplicados', n_banho),
    'categoria', jsonb_build_object(
       'por_chave', (SELECT coalesce(jsonb_object_agg(chave, n), '{}') FROM (SELECT chave, count(*) n FROM _rc WHERE chave IS NOT NULL GROUP BY 1) x),
       'vazias_a_preencher', (SELECT count(*) FROM _rc WHERE cat_atual IS NULL AND chave IS NOT NULL),
       'iguais', (SELECT count(*) FROM _rc WHERE cat_atual IS NOT NULL AND cat_atual = cat_sugerida),
       'divergentes', (SELECT count(*) FROM _rc WHERE cat_atual IS NOT NULL AND cat_sugerida IS NOT NULL AND cat_atual <> cat_sugerida),
       'amostra_divergentes', (SELECT coalesce(jsonb_agg(jsonb_build_object('produto', r.nome, 'atual', ca.name, 'sugerida', cs.name, 'status', r.status)), '[]')
                                 FROM (SELECT * FROM _rc WHERE cat_atual IS NOT NULL AND cat_sugerida IS NOT NULL AND cat_atual <> cat_sugerida ORDER BY nome LIMIT 40) r
                                 JOIN categories ca ON ca.id = r.cat_atual JOIN categories cs ON cs.id = r.cat_sugerida),
       'sem_categoria_na_descricao', (SELECT count(*) FROM _rc WHERE chave IS NULL AND cat_atual IS NULL),
       'amostra_sem_categoria', (SELECT coalesce(jsonb_agg(nome), '[]') FROM (SELECT nome FROM _rc WHERE chave IS NULL AND cat_atual IS NULL ORDER BY nome LIMIT 30) x),
       'categorias_a_criar', CASE WHEN _aplicar THEN criadas ELSE
           (SELECT coalesce(jsonb_agg(DISTINCT nomes_cat->>chave), '[]') FROM _rc WHERE chave IS NOT NULL AND cat_sugerida IS NULL AND (cat_atual IS NULL OR _corrigir_divergentes)) END,
       'categorias_encontradas', (SELECT coalesce(jsonb_object_agg(chave, nm), '{}') FROM
           (SELECT DISTINCT r.chave, c.name nm FROM _rc r JOIN categories c ON c.id = r.cat_sugerida) x),
       'aplicadas', n_cat, 'subcategorias_limpas', n_sub)
  ) INTO res;
  RETURN res;
END $fn$;
REVOKE ALL ON FUNCTION public.produto_reclassificar(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produto_reclassificar(boolean, boolean) TO authenticated, service_role;

-- Desfaz um lote: volta banho, categoria e subcategoria que ainda estão como o lote deixou;
-- categoria criada pelo lote é apagada só se nenhum produto a usar.
CREATE OR REPLACE FUNCTION public.produto_reclassificacao_desfazer(_lote text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE uid uuid := auth.uid(); n_b int; n_c int; n_s int; n_cat int;
BEGIN
  IF uid IS NOT NULL AND NOT (public.has_role(uid, 'master') AND public.has_capability(uid, 'product.manage')) THEN
    RAISE EXCEPTION 'Desfazer a reclassificação é só para o Master.' USING errcode = '42501';
  END IF;
  UPDATE products p SET banho_tipo = NULL, banho_origem = NULL, banho_camada = NULL, updated_at = now()
    FROM produto_reclassificacao r
   WHERE r.lote = _lote AND r.campo = 'banho_tipo' AND r.desfeito_em IS NULL AND r.product_id = p.id
     AND p.banho_tipo = r.depois AND p.banho_origem = 'descricao';
  GET DIAGNOSTICS n_b = ROW_COUNT;
  UPDATE products p SET subcategory_id = r.antes::uuid, updated_at = now()
    FROM produto_reclassificacao r
   WHERE r.lote = _lote AND r.campo = 'subcategory_id' AND r.desfeito_em IS NULL AND r.product_id = p.id AND p.subcategory_id IS NULL
     AND EXISTS (SELECT 1 FROM produto_reclassificacao c WHERE c.lote = _lote AND c.campo = 'category_id' AND c.product_id = p.id
                  AND p.category_id::text = c.depois);
  GET DIAGNOSTICS n_s = ROW_COUNT;
  UPDATE products p SET category_id = r.antes::uuid,
         subcategory_id = CASE WHEN r.antes IS NULL THEN NULL ELSE p.subcategory_id END, updated_at = now()
    FROM produto_reclassificacao r
   WHERE r.lote = _lote AND r.campo = 'category_id' AND r.desfeito_em IS NULL AND r.product_id = p.id
     AND p.category_id::text = r.depois
     AND (r.antes IS NOT NULL OR p.status <> 'publicado');   -- peça publicada não fica sem categoria
  GET DIAGNOSTICS n_c = ROW_COUNT;
  DELETE FROM categories c USING produto_reclassificacao r
   WHERE r.lote = _lote AND r.campo = 'categoria_criada' AND r.category_id = c.id
     AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id OR p.subcategory_id = c.id)
     AND NOT EXISTS (SELECT 1 FROM categories f WHERE f.parent_id = c.id);
  GET DIAGNOSTICS n_cat = ROW_COUNT;
  UPDATE produto_reclassificacao SET desfeito_em = now() WHERE lote = _lote AND desfeito_em IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'catalogo.reclassificacao_desfeita', 'products', _lote,
          jsonb_build_object('banho', n_b, 'categoria', n_c, 'subcategoria', n_s, 'categorias_apagadas', n_cat));
  RETURN jsonb_build_object('banho', n_b, 'categoria', n_c, 'subcategoria', n_s, 'categorias_apagadas', n_cat);
END $fn$;
REVOKE ALL ON FUNCTION public.produto_reclassificacao_desfazer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produto_reclassificacao_desfazer(text) TO authenticated, service_role;
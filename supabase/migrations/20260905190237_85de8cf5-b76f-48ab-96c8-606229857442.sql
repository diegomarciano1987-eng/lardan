DROP VIEW IF EXISTS public.public_product_variants;
DROP VIEW IF EXISTS public.public_products;

-- Tabela pública somente com preços autorizados (price_is_public = true e produto publicado).
CREATE TABLE public.public_price_list (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (product_id, variant_id)
);
GRANT SELECT ON public.public_price_list TO anon, authenticated;
GRANT ALL ON public.public_price_list TO service_role;
ALTER TABLE public.public_price_list ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_price_list_read ON public.public_price_list FOR SELECT TO anon, authenticated USING (true);

-- Sincroniza os preços públicos de um produto (nível produto + variantes).
CREATE OR REPLACE FUNCTION public.sync_public_prices(_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p public.products%ROWTYPE;
BEGIN
  DELETE FROM public.public_price_list WHERE product_id = _product_id;
  SELECT * INTO v_p FROM public.products WHERE id = _product_id;
  IF NOT FOUND OR v_p.status <> 'publicado' OR NOT v_p.price_is_public OR v_p.price_cents IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.public_price_list (product_id, variant_id, price_cents)
  VALUES (v_p.id, NULL, v_p.price_cents);
  INSERT INTO public.public_price_list (product_id, variant_id, price_cents)
  SELECT v.id_product, v.id_variant, coalesce(v.price, v_p.price_cents)
  FROM (SELECT v_p.id AS id_product, vv.id AS id_variant, vv.price_cents AS price
        FROM public.product_variants vv
        WHERE vv.product_id = v_p.id AND vv.is_active) v;
END; $$;
REVOKE ALL ON FUNCTION public.sync_public_prices(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_price_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_public_prices(COALESCE(NEW.id, OLD.id));
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_products_price_sync ON public.products;
CREATE TRIGGER trg_products_price_sync AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_price_product();

CREATE OR REPLACE FUNCTION public.trg_sync_price_variant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.sync_public_prices(COALESCE(NEW.product_id, OLD.product_id));
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_variants_price_sync ON public.product_variants;
CREATE TRIGGER trg_variants_price_sync AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_price_variant();

-- Visitante lê apenas colunas seguras; preço/custo jamais pela tabela base.
REVOKE SELECT ON public.products FROM anon;
REVOKE SELECT ON public.product_variants FROM anon;
GRANT SELECT (id, slug, name, category_id, collection_id, short_description, description, material, plating, measurements, weight_grams, care_instructions, warranty_text, price_is_public, seo_title, seo_description, position, status, published_at, created_at) ON public.products TO anon;
GRANT SELECT (id, product_id, sku, label, size, color, position, is_active) ON public.product_variants TO anon;
CREATE OR REPLACE FUNCTION public.codigo_unico_guarda() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pid uuid;
BEGIN
  IF TG_TABLE_NAME='products' THEN
    pid := NEW.id;
    IF NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE v.barcode=NEW.barcode AND v.product_id<>pid) THEN
      RAISE EXCEPTION 'Código de barras % já pertence a outra peça.', NEW.barcode USING ERRCODE='23505'; END IF;
    IF NEW.reference_code IS NOT NULL AND EXISTS (SELECT 1 FROM product_variants v WHERE upper(v.reference_code)=upper(NEW.reference_code) AND v.product_id<>pid) THEN
      RAISE EXCEPTION 'Referência % já pertence a outra peça.', NEW.reference_code USING ERRCODE='23505'; END IF;
  ELSE
    pid := NEW.product_id;
    IF NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM products p WHERE p.barcode=NEW.barcode AND p.id<>pid) THEN
      RAISE EXCEPTION 'Código de barras % já pertence a outra peça.', NEW.barcode USING ERRCODE='23505'; END IF;
    IF NEW.reference_code IS NOT NULL AND EXISTS (SELECT 1 FROM products p WHERE upper(p.reference_code)=upper(NEW.reference_code) AND p.id<>pid) THEN
      RAISE EXCEPTION 'Referência % já pertence a outra peça.', NEW.reference_code USING ERRCODE='23505'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.codigo_unico_guarda() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_codigo_unico_guarda ON public.products;
CREATE TRIGGER trg_codigo_unico_guarda BEFORE INSERT OR UPDATE OF barcode, reference_code ON public.products FOR EACH ROW EXECUTE FUNCTION public.codigo_unico_guarda();
DROP TRIGGER IF EXISTS trg_codigo_unico_guarda ON public.product_variants;
CREATE TRIGGER trg_codigo_unico_guarda BEFORE INSERT OR UPDATE OF barcode, reference_code, product_id ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.codigo_unico_guarda();
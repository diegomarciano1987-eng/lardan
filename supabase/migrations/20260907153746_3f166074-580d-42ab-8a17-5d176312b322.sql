DROP FUNCTION IF EXISTS public.homolog_purge_stock(text);

CREATE OR REPLACE FUNCTION public.homolog_purge_stock(_prefix text, _limite integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int := 0; t int;
BEGIN
  IF _prefix IS NULL OR length(trim(_prefix)) < 6 THEN
    RAISE EXCEPTION 'Informe o marcador exclusivo da massa de homologação.';
  END IF;
  PERFORM set_config('lardan.homolog_purge','on', true);

  DELETE FROM public.stock_balances sb
   WHERE sb.id IN (
     SELECT sb2.id FROM public.stock_balances sb2
      JOIN public.product_variants v ON v.id = sb2.variant_id
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug LIKE lower(_prefix)||'-%'
      LIMIT _limite);
  GET DIAGNOSTICS t = ROW_COUNT; n := n + t;

  DELETE FROM public.stock_movements sm
   WHERE sm.id IN (
     SELECT sm2.id FROM public.stock_movements sm2
      JOIN public.product_variants v ON v.id = sm2.variant_id
      JOIN public.products p ON p.id = v.product_id
      WHERE p.slug LIKE lower(_prefix)||'-%'
      LIMIT _limite);
  GET DIAGNOSTICS t = ROW_COUNT; n := n + t;

  IF n = 0 THEN
    DELETE FROM public.stock_balances sb USING public.locations l
     WHERE sb.location_id = l.id AND l.code LIKE _prefix||'%';
    GET DIAGNOSTICS t = ROW_COUNT; n := n + t;
    DELETE FROM public.stock_movements sm USING public.locations l
     WHERE l.code LIKE _prefix||'%' AND (sm.from_location_id = l.id OR sm.to_location_id = l.id);
    GET DIAGNOSTICS t = ROW_COUNT; n := n + t;
  END IF;

  PERFORM set_config('lardan.homolog_purge','off', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.homolog_purge_stock(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homolog_purge_stock(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.homolog_purge_catalogo(_prefix text, _limite integer DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int := 0; t int; alvo uuid[];
BEGIN
  IF _prefix IS NULL OR length(trim(_prefix)) < 6 THEN
    RAISE EXCEPTION 'Informe o marcador exclusivo da massa de homologação.';
  END IF;
  PERFORM set_config('lardan.homolog_purge','on', true);

  SELECT array_agg(id) INTO alvo
    FROM (SELECT id FROM public.products
           WHERE slug LIKE lower(_prefix)||'-%' OR name LIKE _prefix||'%'
           LIMIT _limite) q;
  IF alvo IS NULL THEN
    DELETE FROM public.categories WHERE slug LIKE lower(_prefix)||'-%' OR name LIKE _prefix||'%';
    DELETE FROM public.collections WHERE slug LIKE lower(_prefix)||'-%' OR name LIKE _prefix||'%';
    DELETE FROM public.suppliers WHERE name LIKE _prefix||'%';
    DELETE FROM public.locations WHERE code LIKE _prefix||'%';
    PERFORM set_config('lardan.homolog_purge','off', true);
    RETURN 0;
  END IF;

  DELETE FROM public.stock_movements sm USING public.product_variants v
   WHERE sm.variant_id = v.id AND v.product_id = ANY(alvo);
  DELETE FROM public.stock_balances sb USING public.product_variants v
   WHERE sb.variant_id = v.id AND v.product_id = ANY(alvo);
  DELETE FROM public.variant_costs vc USING public.product_variants v
   WHERE vc.variant_id = v.id AND v.product_id = ANY(alvo);
  DELETE FROM public.public_price_list WHERE product_id = ANY(alvo);
  DELETE FROM public.product_media WHERE product_id = ANY(alvo);
  UPDATE public.import_rows SET variant_id = NULL, movement_id = NULL
   WHERE variant_id IN (SELECT id FROM public.product_variants WHERE product_id = ANY(alvo));
  DELETE FROM public.product_variants WHERE product_id = ANY(alvo);
  UPDATE public.import_rows SET product_id = NULL WHERE product_id = ANY(alvo);
  DELETE FROM public.products WHERE id = ANY(alvo);
  GET DIAGNOSTICS t = ROW_COUNT; n := n + t;

  PERFORM set_config('lardan.homolog_purge','off', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.homolog_purge_catalogo(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homolog_purge_catalogo(text,integer) TO service_role;
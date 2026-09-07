CREATE OR REPLACE FUNCTION public.block_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('lardan.homolog_purge', true) = 'on'
     AND OLD.reference IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Movimentações de estoque são imutáveis.';
END $$;

CREATE OR REPLACE FUNCTION public.homolog_purge_stock(_prefix text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int := 0; t int;
BEGIN
  IF _prefix IS NULL OR length(trim(_prefix)) < 6 THEN
    RAISE EXCEPTION 'Informe o marcador exclusivo da massa de homologação.';
  END IF;
  PERFORM set_config('lardan.homolog_purge','on', true);

  DELETE FROM public.stock_balances sb
   USING public.product_variants v, public.products p
   WHERE sb.variant_id = v.id AND v.product_id = p.id AND p.slug LIKE lower(_prefix)||'-%';

  DELETE FROM public.stock_balances sb USING public.locations l
   WHERE sb.location_id = l.id AND l.code LIKE _prefix||'%';

  DELETE FROM public.stock_movements sm
   USING public.product_variants v, public.products p
   WHERE sm.variant_id = v.id AND v.product_id = p.id AND p.slug LIKE lower(_prefix)||'-%';
  GET DIAGNOSTICS t = ROW_COUNT; n := n + t;

  DELETE FROM public.stock_movements sm USING public.locations l
   WHERE l.code LIKE _prefix||'%' AND (sm.from_location_id = l.id OR sm.to_location_id = l.id);
  GET DIAGNOSTICS t = ROW_COUNT; n := n + t;

  PERFORM set_config('lardan.homolog_purge','off', true);
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.homolog_purge_stock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.homolog_purge_stock(text) TO service_role;
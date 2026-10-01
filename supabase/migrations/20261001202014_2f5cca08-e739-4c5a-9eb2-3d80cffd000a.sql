CREATE OR REPLACE FUNCTION public.apply_stock_delta(_variant uuid, _location uuid, _delta integer)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE novo integer;
BEGIN
  INSERT INTO public.stock_balances (variant_id, location_id, quantity)
  VALUES (_variant, _location, 0) ON CONFLICT (variant_id, location_id) DO NOTHING;
  UPDATE public.stock_balances SET quantity = quantity + _delta, updated_at = now()
   WHERE variant_id = _variant AND location_id = _location RETURNING quantity INTO novo;
  -- Saldo negativo só é aceito no desbloqueio interno auditado (estoque ainda não contado).
  IF novo < 0 AND coalesce(current_setting('lardan.stock_unblock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Saldo insuficiente: a operação deixaria % peças neste local.', novo;
  END IF;
  RETURN novo;
END $function$;
REVOKE ALL ON FUNCTION public.apply_stock_delta(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
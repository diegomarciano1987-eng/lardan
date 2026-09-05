CREATE OR REPLACE FUNCTION public.block_stock_movement_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Movimentações de estoque são imutáveis.';
END $$;
REVOKE EXECUTE ON FUNCTION public.block_stock_movement_mutation() FROM PUBLIC, anon;

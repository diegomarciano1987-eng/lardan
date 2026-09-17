DO $$
DECLARE _t text;
BEGIN
  PERFORM set_config('statement_timeout', '300s', true);
  FOR _t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'stock\_%'
  LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', _t); END LOOP;

  UPDATE public.stock_movements SET reservation_id = NULL WHERE reservation_id IS NOT NULL;
  DELETE FROM public.stock_reservations;
  DELETE FROM public.stock_movements;
  DELETE FROM public.stock_balances;

  FOR _t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'stock\_%'
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', _t); END LOOP;
END $$;
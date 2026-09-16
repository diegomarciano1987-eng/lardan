DO $do$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
            WHERE pronamespace='public'::regnamespace
              AND proname IN ('import_job_open','import_products_stock')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF position('has_capability(auth.uid(),''imports.run'')' IN d) > 0 THEN
      EXECUTE replace(d, 'public.has_capability(auth.uid(),''imports.run'')',
                         'public.import_pode_produto(auth.uid())');
    END IF;
  END LOOP;
END $do$;

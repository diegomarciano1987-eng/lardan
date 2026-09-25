CREATE UNIQUE INDEX IF NOT EXISTS profiles_party_id_unico ON public.profiles(party_id) WHERE party_id IS NOT NULL;

DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.kit_entrada_bipar(uuid,text,text)'::regprocedure) INTO src;
  src := replace(src,
'                AND coalesce(b.qty_accepted,0) + coalesce(b.qty_allocated,0) * 0
                    - coalesce(b.qty_sold,0) - coalesce(b.qty_returned,0) - coalesce(b.qty_return_transit,0)
                    - coalesce(b.qty_lost,0) > 0) THEN',
'                AND greatest(coalesce(b.qty_allocated,0), coalesce(b.qty_accepted,0))
                    - coalesce(b.qty_sold,0) - coalesce(b.qty_returned,0)
                    - coalesce(b.qty_lost,0) > 0) THEN');
  IF position('greatest(coalesce(b.qty_allocated' in src) = 0 THEN RAISE EXCEPTION 'patch falhou'; END IF;
  EXECUTE src;
END $do$;
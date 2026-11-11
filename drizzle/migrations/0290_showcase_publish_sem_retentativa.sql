-- 40001 (serialization_failure) makes PostgREST retry the request forever; the revision conflict on publish
-- uses the same custom non-retryable code already adopted by showcase_design_save (P0409).
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.showcase_design_publish(integer)'::regprocedure), 'errcode=''40001''', 'errcode=''P0409''');
END $$;
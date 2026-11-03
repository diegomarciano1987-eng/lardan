-- 40001 (serialization_failure) makes PostgREST retry in a loop; use a custom non-retryable code for the revision conflict.
DO $$ BEGIN EXECUTE replace(pg_get_functiondef('public.showcase_design_save(jsonb,integer)'::regprocedure), 'errcode=''40001''', 'errcode=''P0409'''); END $$;

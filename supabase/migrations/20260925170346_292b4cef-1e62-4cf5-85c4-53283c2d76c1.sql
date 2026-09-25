DO $$ DECLARE src text; BEGIN
  SELECT pg_get_functiondef('public.painel_visao_geral()'::regprocedure) INTO src;
  src := replace(src, 'SECURITY INVOKER', 'SECURITY DEFINER');
  src := replace(src, 'LANGUAGE sql', 'LANGUAGE sql');
  src := regexp_replace(src, 'AS \$function\$\s*select jsonb_build_object\(', 'AS $function$ select case when not public.has_capability(auth.uid(), ''finance.view'') then null::jsonb else jsonb_build_object(');
  src := regexp_replace(src, '\);\s*\$function\$\s*$', ') end; $function$');
  EXECUTE src;
END $$;
ALTER FUNCTION public.painel_visao_geral() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.painel_visao_geral() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.painel_visao_geral() TO authenticated;
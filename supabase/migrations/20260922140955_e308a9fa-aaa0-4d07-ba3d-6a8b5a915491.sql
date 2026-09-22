
REVOKE ALL ON FUNCTION public.crm_representantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_representantes() TO authenticated;

REVOKE ALL ON FUNCTION public.has_capability(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_capability(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resync_all_public_prices() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_all_public_prices() TO service_role;
REVOKE ALL ON FUNCTION public.my_capabilities() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_capabilities() TO authenticated, service_role;
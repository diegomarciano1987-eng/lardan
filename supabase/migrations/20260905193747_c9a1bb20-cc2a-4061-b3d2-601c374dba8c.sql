REVOKE ALL ON FUNCTION public.ensure_default_variant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_catalog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_costs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_catalog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_costs(uuid) TO authenticated;
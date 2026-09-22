
REVOKE EXECUTE ON FUNCTION public.kit_cycle_in_scope(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_scope_all() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_party_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_cycle_in_scope(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kit_scope_all() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_party_id() TO authenticated, service_role;

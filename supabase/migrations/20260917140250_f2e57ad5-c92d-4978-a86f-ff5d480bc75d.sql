REVOKE EXECUTE ON FUNCTION public.can_manage_kits(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_kits(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_party_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_cycle_in_scope(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_reference_price(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_events_immutable() FROM anon, authenticated;

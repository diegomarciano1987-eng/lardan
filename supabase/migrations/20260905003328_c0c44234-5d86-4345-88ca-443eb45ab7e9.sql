CREATE OR REPLACE FUNCTION public.claim_master_role()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := auth.uid();
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão autenticada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'master') THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (v_id, 'master', v_id)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (v_id, 'bootstrap.claim_master', 'user_roles', v_id::text, jsonb_build_object('role','master'));
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.claim_master_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_master_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_roles()
RETURNS SETOF public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.my_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_roles() TO authenticated;

CREATE OR REPLACE FUNCTION public.master_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'master');
$$;
REVOKE ALL ON FUNCTION public.master_exists() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.master_exists() TO authenticated;
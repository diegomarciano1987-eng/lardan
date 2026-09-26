REVOKE ALL ON FUNCTION public.access_roles_replace(uuid, public.app_role[]) FROM authenticated, service_role;

CREATE OR REPLACE FUNCTION public.access_roles_replace_admin(_user_id uuid, _roles public.app_role[], _actor_id uuid)
RETURNS public.app_role[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  antes public.app_role[];
  depois public.app_role[];
  removendo_master boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.is_active
    WHERE ur.user_id = _actor_id AND ur.role = 'master'::public.app_role
  ) THEN
    RAISE EXCEPTION 'Somente o Master pode editar acessos.';
  END IF;
  IF _user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Colaborador inexistente ou inativo.';
  END IF;

  SELECT coalesce(array_agg(role ORDER BY role), '{}'::public.app_role[])
    INTO antes FROM public.user_roles WHERE user_id = _user_id;

  SELECT 'master'::public.app_role = ANY(antes)
     AND NOT ('master'::public.app_role = ANY(coalesce(_roles, '{}'::public.app_role[])))
    INTO removendo_master;

  IF removendo_master AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.is_active
    WHERE ur.role = 'master'::public.app_role AND ur.user_id <> _user_id
  ) THEN
    RAISE EXCEPTION 'O último Master ativo não pode perder esse acesso.';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _user_id
     AND NOT (role = ANY(coalesce(_roles, '{}'::public.app_role[])));

  INSERT INTO public.user_roles (user_id, role, granted_by)
  SELECT _user_id, role, _actor_id
  FROM unnest(coalesce(_roles, '{}'::public.app_role[])) AS role
  ON CONFLICT (user_id, role) DO NOTHING;

  SELECT coalesce(array_agg(role ORDER BY role), '{}'::public.app_role[])
    INTO depois FROM public.user_roles WHERE user_id = _user_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (_actor_id, 'access.roles.replace', 'user_roles', _user_id::text,
    jsonb_build_object('antes', antes, 'depois', depois));
  RETURN depois;
END
$fn$;

REVOKE ALL ON FUNCTION public.access_roles_replace_admin(uuid, public.app_role[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.access_roles_replace_admin(uuid, public.app_role[], uuid) TO service_role;
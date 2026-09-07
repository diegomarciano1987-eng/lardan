CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := auth.uid();
  v_email text;
  v_name text;
  v_row public.profiles;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão autenticada.';
  END IF;

  SELECT * INTO v_row FROM public.profiles WHERE id = v_id;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT u.email, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    INTO v_email, v_name FROM auth.users u WHERE u.id = v_id;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_id, v_name, v_email)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email, updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END; $function$;

WITH orfas AS (
  SELECT p.id
  FROM public.parties p
  WHERE p.kind = 'pessoa'
    AND p.doc IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.leads x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.suppliers x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.business_entities x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.consultant_profiles x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.party_addresses x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.contact_points x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.party_links x WHERE x.party_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.award_grants x WHERE x.party_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.party_roles r
      WHERE r.party_id = p.id AND r.role <> 'usuario'
    )
)
DELETE FROM public.parties WHERE id IN (SELECT id FROM orfas);
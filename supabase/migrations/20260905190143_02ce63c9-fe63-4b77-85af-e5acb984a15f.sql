CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE ur.user_id = _user_id AND ur.role = _role AND p.is_active);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE ur.user_id = _user_id AND ur.role = ANY(_roles) AND p.is_active);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL
     AND _user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                 JOIN public.profiles p ON p.id = ur.user_id
                 WHERE ur.user_id = _user_id AND p.is_active);
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'master') THEN
      RAISE EXCEPTION 'Somente o Master pode ativar ou desativar usuários.';
    END IF;
    IF OLD.id = auth.uid() AND NEW.is_active = false THEN
      RAISE EXCEPTION 'O Master não pode desativar a própria conta.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_profiles_guard ON public.profiles;
CREATE TRIGGER trg_profiles_guard BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

INSERT INTO public.site_settings (key, value, is_public)
VALUES ('security.bootstrap', '{"emails":[]}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_master_role()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := auth.uid();
  v_email text;
  v_allowed jsonb;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão autenticada.';
  END IF;
  PERFORM pg_advisory_xact_lock(920001);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'master') THEN
    RETURN false;
  END IF;
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_id;
  SELECT s.value->'emails' INTO v_allowed
    FROM public.site_settings s WHERE s.key = 'security.bootstrap';
  IF v_email IS NULL OR v_allowed IS NULL
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_allowed) e
                    WHERE lower(e) = lower(v_email)) THEN
    RAISE EXCEPTION 'Provisionamento do primeiro Master bloqueado: identidade não autorizada.';
  END IF;
  INSERT INTO public.user_roles (user_id, role, granted_by) VALUES (v_id, 'master', v_id)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (v_id, 'bootstrap.claim_master', 'user_roles', v_id::text, jsonb_build_object('role','master'));
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.claim_master_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_master_role() TO authenticated;

DROP POLICY IF EXISTS user_roles_master_write ON public.user_roles;

CREATE OR REPLACE FUNCTION public.guard_last_master()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'master')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'master' AND NEW.role IS DISTINCT FROM 'master') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id AND p.is_active
      WHERE ur.role = 'master' AND ur.user_id <> OLD.user_id
    ) THEN
      RAISE EXCEPTION 'Não é permitido remover o último Master ativo.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_user_roles_last_master ON public.user_roles;
CREATE TRIGGER trg_user_roles_last_master BEFORE DELETE OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_master();

CREATE OR REPLACE FUNCTION public.grant_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Apenas o Master pode atribuir papéis.';
  END IF;
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Usuário inexistente.';
  END IF;
  INSERT INTO public.user_roles (user_id, role, granted_by)
  VALUES (_user_id, _role, auth.uid())
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'roles.grant', 'user_roles', _user_id::text, jsonb_build_object('role', _role));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'Apenas o Master pode revogar papéis.';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'roles.revoke', 'user_roles', _user_id::text, jsonb_build_object('role', _role));
  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION public.grant_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_role(uuid, public.app_role) TO authenticated;

REVOKE SELECT ON public.products FROM anon;
REVOKE SELECT ON public.product_variants FROM anon;

CREATE OR REPLACE VIEW public.public_products
WITH (security_barrier = true) AS
SELECT p.id, p.slug, p.name, p.category_id, p.collection_id,
       p.short_description, p.description, p.material, p.plating,
       p.measurements, p.weight_grams, p.care_instructions, p.warranty_text,
       CASE WHEN p.price_is_public THEN p.price_cents ELSE NULL END AS price_cents,
       p.price_is_public, p.seo_title, p.seo_description, p.position, p.published_at
FROM public.products p
WHERE p.status = 'publicado';
GRANT SELECT ON public.public_products TO anon, authenticated;

CREATE OR REPLACE VIEW public.public_product_variants
WITH (security_barrier = true) AS
SELECT v.id, v.product_id, v.sku, v.label, v.size, v.color, v.position,
       CASE WHEN p.price_is_public THEN coalesce(v.price_cents, p.price_cents) ELSE NULL END AS price_cents
FROM public.product_variants v
JOIN public.products p ON p.id = v.product_id
WHERE v.is_active AND p.status = 'publicado';
GRANT SELECT ON public.public_product_variants TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entity_id text;
BEGIN
  v_entity_id := COALESCE(
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW)->>'id' END,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD)->>'id' END
  );
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (
    auth.uid(),
    lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    jsonb_build_object(
      'old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
    )
  );
  RETURN COALESCE(NEW, OLD);
END; $$;
REVOKE ALL ON FUNCTION public.audit_row_change() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','profiles','products','product_variants','categories','collections','pages','site_settings','media_assets']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t, t);
  END LOOP;
END $$;
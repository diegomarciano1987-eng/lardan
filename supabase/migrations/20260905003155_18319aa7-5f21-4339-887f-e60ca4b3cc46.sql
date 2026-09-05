-- ============ LARDAN — Lote 2: fundação de dados ============
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.app_role AS ENUM (
  'master','diretoria','marketing','suporte','financeiro','cobranca',
  'estoque','montagem','qualidade','representante','consultora'
);

CREATE TYPE public.content_status AS ENUM ('rascunho','revisao','publicado','arquivado');
CREATE TYPE public.lead_status  AS ENUM ('novo','em_analise','qualificado','aprovado','recusado','arquivado');
CREATE TYPE public.request_status AS ENUM ('novo','em_atendimento','respondido','arquivado');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.gen_protocol(prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT prefix || '-' || to_char(now() AT TIME ZONE 'UTC','YYYYMMDD') || '-' ||
         upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_content(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['master','diretoria','marketing']::public.app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_leads(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['master','diretoria','marketing','suporte']::public.app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id);
$$;

CREATE POLICY profiles_select_self ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]));
CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'master'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'master'));

CREATE POLICY user_roles_select_self ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]));
CREATE POLICY user_roles_master_write ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text,
  url text NOT NULL,
  alt text NOT NULL DEFAULT '',
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  byte_size integer CHECK (byte_size IS NULL OR byte_size >= 0),
  content_type text,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.media_assets TO anon;
GRANT SELECT, INSERT, UPDATE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_media_updated BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY media_public_read ON public.media_assets FOR SELECT TO anon, authenticated
  USING (is_archived = false);
CREATE POLICY media_manage ON public.media_assets FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  hero_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  seo_title text,
  seo_description text,
  position integer NOT NULL DEFAULT 0,
  status public.content_status NOT NULL DEFAULT 'rascunho',
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY categories_public_read ON public.categories FOR SELECT TO anon, authenticated
  USING (status = 'publicado');
CREATE POLICY categories_staff_read ON public.categories FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()));
CREATE POLICY categories_manage ON public.categories FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  hero_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  seo_title text,
  seo_description text,
  position integer NOT NULL DEFAULT 0,
  status public.content_status NOT NULL DEFAULT 'rascunho',
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.collections TO anon;
GRANT SELECT, INSERT, UPDATE ON public.collections TO authenticated;
GRANT ALL ON public.collections TO service_role;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_collections_updated BEFORE UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY collections_public_read ON public.collections FOR SELECT TO anon, authenticated
  USING (status = 'publicado');
CREATE POLICY collections_staff_read ON public.collections FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()));
CREATE POLICY collections_manage ON public.collections FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  collection_id uuid REFERENCES public.collections(id) ON DELETE SET NULL,
  short_description text,
  description text,
  material text,
  plating text,
  measurements text,
  weight_grams numeric(8,2) CHECK (weight_grams IS NULL OR weight_grams > 0),
  care_instructions text,
  warranty_text text,
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  price_is_public boolean NOT NULL DEFAULT false,
  seo_title text,
  seo_description text,
  position integer NOT NULL DEFAULT 0,
  status public.content_status NOT NULL DEFAULT 'rascunho',
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_category ON public.products(category_id);
CREATE INDEX idx_products_collection ON public.products(collection_id);
CREATE INDEX idx_products_status ON public.products(status);
GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY products_public_read ON public.products FOR SELECT TO anon, authenticated
  USING (status = 'publicado');
CREATE POLICY products_staff_read ON public.products FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()));
CREATE POLICY products_manage ON public.products FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku text UNIQUE,
  label text NOT NULL,
  size text,
  color text,
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  position integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, label)
);
GRANT SELECT ON public.product_variants TO anon;
GRANT SELECT, INSERT, UPDATE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_variants_updated BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY variants_public_read ON public.product_variants FOR SELECT TO anon, authenticated
  USING (is_active AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.status = 'publicado'));
CREATE POLICY variants_manage ON public.product_variants FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, media_id)
);
GRANT SELECT ON public.product_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media TO authenticated;
GRANT ALL ON public.product_media TO service_role;
ALTER TABLE public.product_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_media_public_read ON public.product_media FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND p.status = 'publicado'));
CREATE POLICY product_media_manage ON public.product_media FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(/[a-z0-9-]+)*(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  seo_title text,
  seo_description text,
  status public.content_status NOT NULL DEFAULT 'rascunho',
  published_version integer,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE ON public.pages TO authenticated;
GRANT ALL ON public.pages TO service_role;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_pages_updated BEFORE UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY pages_public_read ON public.pages FOR SELECT TO anon, authenticated
  USING (status = 'publicado');
CREATE POLICY pages_staff_read ON public.pages FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()));
CREATE POLICY pages_manage ON public.pages FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version)
);
GRANT SELECT ON public.page_versions TO anon;
GRANT SELECT, INSERT ON public.page_versions TO authenticated;
GRANT ALL ON public.page_versions TO service_role;
ALTER TABLE public.page_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_versions_public_read ON public.page_versions FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.pages p
                 WHERE p.id = page_id AND p.status = 'publicado' AND p.published_version = version));
CREATE POLICY page_versions_manage ON public.page_versions FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE OR REPLACE FUNCTION public.block_page_version_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Versões de página são imutáveis; crie uma nova versão.';
END; $$;
CREATE TRIGGER trg_page_versions_immutable BEFORE UPDATE OR DELETE ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION public.block_page_version_mutation();

CREATE TABLE public.site_settings (
  key text PRIMARY KEY CHECK (length(btrim(key)) > 0),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY settings_public_read ON public.site_settings FOR SELECT TO anon, authenticated
  USING (is_public = true);
CREATE POLICY settings_manage ON public.site_settings FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid())) WITH CHECK (public.can_manage_content(auth.uid()));

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol text NOT NULL UNIQUE DEFAULT public.gen_protocol('CAP'),
  full_name text NOT NULL CHECK (length(btrim(full_name)) >= 2),
  whatsapp text NOT NULL CHECK (length(regexp_replace(whatsapp,'\D','','g')) BETWEEN 10 AND 13),
  street text,
  street_number text,
  no_number boolean NOT NULL DEFAULT false,
  city text NOT NULL CHECK (length(btrim(city)) > 0),
  uf char(2) NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  postal_code text CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}-?[0-9]{3}$'),
  financial_goal text,
  availability text,
  experience text,
  audience text,
  motivation text,
  source text,
  entry_url text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_version text NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  status public.lead_status NOT NULL DEFAULT 'novo',
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_created ON public.leads(created_at DESC);
GRANT INSERT ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY leads_public_insert ON public.leads FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'novo' AND assigned_to IS NULL);
CREATE POLICY leads_staff_read ON public.leads FOR SELECT TO authenticated
  USING (public.can_manage_leads(auth.uid()));
CREATE POLICY leads_staff_update ON public.leads FOR UPDATE TO authenticated
  USING (public.can_manage_leads(auth.uid())) WITH CHECK (public.can_manage_leads(auth.uid()));

CREATE TABLE public.lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  note text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_events_lead ON public.lead_events(lead_id, created_at DESC);
GRANT SELECT, INSERT ON public.lead_events TO authenticated;
GRANT ALL ON public.lead_events TO service_role;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_events_staff_read ON public.lead_events FOR SELECT TO authenticated
  USING (public.can_manage_leads(auth.uid()));
CREATE POLICY lead_events_staff_insert ON public.lead_events FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_leads(auth.uid()) AND actor_id = auth.uid());

CREATE TABLE public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol text NOT NULL UNIQUE DEFAULT public.gen_protocol('CON'),
  full_name text NOT NULL CHECK (length(btrim(full_name)) >= 2),
  contact_channel text NOT NULL,
  contact_value text NOT NULL CHECK (length(btrim(contact_value)) > 0),
  subject text NOT NULL,
  message text NOT NULL CHECK (length(btrim(message)) >= 5),
  source text,
  entry_url text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_version text NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  status public.request_status NOT NULL DEFAULT 'novo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_created ON public.contact_requests(created_at DESC);
GRANT INSERT ON public.contact_requests TO anon;
GRANT SELECT, INSERT, UPDATE ON public.contact_requests TO authenticated;
GRANT ALL ON public.contact_requests TO service_role;
ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_contact_updated BEFORE UPDATE ON public.contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY contact_public_insert ON public.contact_requests FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'novo');
CREATE POLICY contact_staff_read ON public.contact_requests FOR SELECT TO authenticated
  USING (public.can_manage_leads(auth.uid()));
CREATE POLICY contact_staff_update ON public.contact_requests FOR UPDATE TO authenticated
  USING (public.can_manage_leads(auth.uid())) WITH CHECK (public.can_manage_leads(auth.uid()));

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_logs(entity, entity_id);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['master','diretoria']::public.app_role[]));
CREATE POLICY audit_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());
CREATE OR REPLACE FUNCTION public.block_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Registros de auditoria são imutáveis.';
END; $$;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_audit_mutation();

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := auth.uid();
  v_email text;
  v_name text;
  v_row public.profiles;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão autenticada.';
  END IF;
  SELECT u.email, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    INTO v_email, v_name FROM auth.users u WHERE u.id = v_id;
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (v_id, v_name, v_email)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.ensure_profile() FROM public;
GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
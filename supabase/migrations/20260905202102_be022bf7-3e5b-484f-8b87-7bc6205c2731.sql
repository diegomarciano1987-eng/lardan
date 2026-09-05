-- =========================================================
-- L3.4-A1: corrigir public_price_list (variant_id NULL)
-- =========================================================
ALTER TABLE public.public_price_list
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.public_price_list DROP CONSTRAINT IF EXISTS public_price_list_pkey;
ALTER TABLE public.public_price_list ADD CONSTRAINT public_price_list_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS public_price_list_product_row_uidx
  ON public.public_price_list (product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS public_price_list_variant_row_uidx
  ON public.public_price_list (product_id, variant_id) WHERE variant_id IS NOT NULL;

-- backfill seguro: ressincroniza todos os produtos publicados
CREATE OR REPLACE FUNCTION public.resync_all_public_prices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.products LOOP
    PERFORM public.sync_public_prices(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;

-- =========================================================
-- L3.4-A2: matriz de autorização única
-- =========================================================
CREATE TABLE IF NOT EXISTS public.role_capabilities (
  role public.app_role NOT NULL,
  capability text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability)
);

GRANT SELECT ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_capabilities_read ON public.role_capabilities;
CREATE POLICY role_capabilities_read ON public.role_capabilities
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS role_capabilities_master ON public.role_capabilities;
CREATE POLICY role_capabilities_master ON public.role_capabilities
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    WHERE ur.user_id = _user_id AND rc.capability = _cap
  );
$$;

CREATE OR REPLACE FUNCTION public.my_capabilities()
RETURNS TABLE (capability text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT rc.capability
  FROM public.user_roles ur
  JOIN public.role_capabilities rc ON rc.role = ur.role
  WHERE ur.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_capabilities() FROM public;
GRANT EXECUTE ON FUNCTION public.my_capabilities() TO authenticated;

-- seed determinístico da matriz
DELETE FROM public.role_capabilities;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'master'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','catalog.manage','catalog.publish','catalog.cost.view',
  'partners.view','partners.manage',
  'stock.view','stock.operate','stock.adjust',
  'imports.run',
  'finance.view','finance.operate','finance.approve',
  'site.manage','users.manage','audit.view'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'diretoria'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','catalog.manage','catalog.publish','catalog.cost.view',
  'partners.view','partners.manage',
  'stock.view','stock.operate','stock.adjust',
  'imports.run',
  'finance.view','finance.operate','finance.approve',
  'site.manage','audit.view'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'estoque'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','catalog.manage','catalog.cost.view',
  'partners.view','partners.manage',
  'stock.view','stock.operate','stock.adjust',
  'imports.run'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'financeiro'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','catalog.cost.view','partners.view',
  'stock.view','finance.view','finance.operate'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'marketing'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','catalog.manage','catalog.publish','site.manage'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'suporte'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','stock.view'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'cobranca'::public.app_role, c FROM unnest(ARRAY[
  'finance.view'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'montagem'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','stock.view','stock.operate'
]) c;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'qualidade'::public.app_role, c FROM unnest(ARRAY[
  'catalog.view','stock.view'
]) c;

-- representante e consultora: sem capacidades administrativas nesta fase.

-- helpers legados passam a delegar para a matriz (sem quebrar código existente)
CREATE OR REPLACE FUNCTION public.can_manage_content(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_capability(_user_id, 'site.manage');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_catalog(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_capability(_user_id, 'catalog.manage');
$$;

CREATE OR REPLACE FUNCTION public.can_view_costs(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_capability(_user_id, 'catalog.cost.view');
$$;

-- ---------- políticas de catálogo ----------
DROP POLICY IF EXISTS products_staff_read ON public.products;
CREATE POLICY products_staff_read ON public.products FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.view'));
DROP POLICY IF EXISTS products_manage ON public.products;
CREATE POLICY products_manage ON public.products FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage'));

DROP POLICY IF EXISTS variants_manage ON public.product_variants;
CREATE POLICY variants_manage ON public.product_variants FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage'));
DROP POLICY IF EXISTS variants_staff_read ON public.product_variants;
CREATE POLICY variants_staff_read ON public.product_variants FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.view'));

DROP POLICY IF EXISTS product_media_manage ON public.product_media;
CREATE POLICY product_media_manage ON public.product_media FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage'));
DROP POLICY IF EXISTS product_media_staff_read ON public.product_media;
CREATE POLICY product_media_staff_read ON public.product_media FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.view'));

DROP POLICY IF EXISTS categories_staff_read ON public.categories;
CREATE POLICY categories_staff_read ON public.categories FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.view'));
DROP POLICY IF EXISTS categories_manage ON public.categories;
CREATE POLICY categories_manage ON public.categories FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage'));

DROP POLICY IF EXISTS collections_staff_read ON public.collections;
CREATE POLICY collections_staff_read ON public.collections FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.view'));
DROP POLICY IF EXISTS collections_manage ON public.collections;
CREATE POLICY collections_manage ON public.collections FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage'));

DROP POLICY IF EXISTS media_manage ON public.media_assets;
CREATE POLICY media_manage ON public.media_assets FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'catalog.manage') OR public.has_capability(auth.uid(), 'site.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'catalog.manage') OR public.has_capability(auth.uid(), 'site.manage'));

-- ---------- políticas de conteúdo do site ----------
DROP POLICY IF EXISTS pages_staff_read ON public.pages;
CREATE POLICY pages_staff_read ON public.pages FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'site.manage'));
DROP POLICY IF EXISTS pages_manage ON public.pages;
CREATE POLICY pages_manage ON public.pages FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'site.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'site.manage'));

DROP POLICY IF EXISTS page_versions_manage ON public.page_versions;
CREATE POLICY page_versions_manage ON public.page_versions FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'site.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'site.manage'));

DROP POLICY IF EXISTS settings_manage ON public.site_settings;
CREATE POLICY settings_manage ON public.site_settings FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'site.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'site.manage'));

-- ---------- parceiros e locais (Marketing perde acesso) ----------
DROP POLICY IF EXISTS suppliers_staff_read ON public.suppliers;
CREATE POLICY suppliers_staff_read ON public.suppliers FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'partners.view'));
DROP POLICY IF EXISTS suppliers_manage ON public.suppliers;
CREATE POLICY suppliers_manage ON public.suppliers FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'partners.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'partners.manage'));

DROP POLICY IF EXISTS business_entities_staff_read ON public.business_entities;
CREATE POLICY business_entities_staff_read ON public.business_entities FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'partners.view'));
DROP POLICY IF EXISTS business_entities_manage ON public.business_entities;
CREATE POLICY business_entities_manage ON public.business_entities FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'partners.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'partners.manage'));

DROP POLICY IF EXISTS locations_manage ON public.locations;
CREATE POLICY locations_manage ON public.locations FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'partners.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'partners.manage'));
DROP POLICY IF EXISTS locations_staff_read ON public.locations;
CREATE POLICY locations_staff_read ON public.locations FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.view') OR public.has_capability(auth.uid(), 'partners.view'));

-- =========================================================
-- L3.4-A4 (parcial): índices de busca reais
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS public.products_name_trgm_idx;
CREATE INDEX products_name_trgm_idx ON public.products USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS categories_name_trgm_idx ON public.categories USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS collections_name_trgm_idx ON public.collections USING gin (lower(name) gin_trgm_ops);

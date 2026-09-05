-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.can_manage_catalog(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['master','diretoria','estoque','marketing']::public.app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.can_view_costs(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY['master','diretoria','financeiro','estoque']::public.app_role[]);
$$;

-- ============ fornecedores ============
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trade_name text,
  tax_id text,
  contact_name text,
  email text,
  phone text,
  city text,
  uf char(2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_tax_id_key ON public.suppliers (tax_id) WHERE tax_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_staff_read ON public.suppliers FOR SELECT TO authenticated USING (public.can_manage_catalog(auth.uid()));
CREATE POLICY suppliers_manage ON public.suppliers FOR ALL TO authenticated USING (public.can_manage_catalog(auth.uid())) WITH CHECK (public.can_manage_catalog(auth.uid()));

-- ============ entidades de negócio ============
CREATE TABLE public.business_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  tax_id text,
  state_registration text,
  city text,
  uf char(2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_entities_tax_id_key ON public.business_entities (tax_id) WHERE tax_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_entities TO authenticated;
GRANT ALL ON public.business_entities TO service_role;
ALTER TABLE public.business_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_entities_staff_read ON public.business_entities FOR SELECT TO authenticated USING (public.can_manage_catalog(auth.uid()));
CREATE POLICY business_entities_manage ON public.business_entities FOR ALL TO authenticated USING (public.can_manage_catalog(auth.uid())) WITH CHECK (public.can_manage_catalog(auth.uid()));

-- ============ locais físicos ============
CREATE TYPE public.location_type AS ENUM ('deposito','loja','maleta','transito','outro');
CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  kind public.location_type NOT NULL DEFAULT 'deposito',
  business_entity_id uuid REFERENCES public.business_entities(id),
  responsible_user_id uuid REFERENCES auth.users(id),
  address text,
  city text,
  uf char(2),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX locations_code_key ON public.locations (lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_staff_read ON public.locations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY locations_manage ON public.locations FOR ALL TO authenticated USING (public.can_manage_catalog(auth.uid())) WITH CHECK (public.can_manage_catalog(auth.uid()));

-- ============ produtos e variantes ============
ALTER TABLE public.products
  ADD COLUMN supplier_id uuid REFERENCES public.suppliers(id),
  ADD COLUMN business_entity_id uuid REFERENCES public.business_entities(id),
  ADD COLUMN legacy_code text;
CREATE INDEX products_legacy_code_idx ON public.products (legacy_code);
CREATE INDEX products_name_trgm_idx ON public.products (lower(name));

ALTER TABLE public.product_variants
  ADD COLUMN barcode text,
  ADD COLUMN legacy_code text,
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX product_variants_sku_upper_idx ON public.product_variants (upper(sku)) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX product_variants_barcode_key ON public.product_variants (barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX product_variants_one_default ON public.product_variants (product_id) WHERE is_default;
CREATE INDEX product_variants_legacy_code_idx ON public.product_variants (legacy_code);

-- toda criação de produto gera variante padrão vendável
CREATE OR REPLACE FUNCTION public.ensure_default_variant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE product_id = NEW.id) THEN
    INSERT INTO public.product_variants (product_id, label, is_default, is_active, position)
    VALUES (NEW.id, 'Padrão', true, true, 0);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_products_default_variant
AFTER INSERT ON public.products
FOR EACH ROW EXECUTE FUNCTION public.ensure_default_variant();

-- backfill das variantes padrão para produtos existentes
INSERT INTO public.product_variants (product_id, label, is_default, is_active, position)
SELECT p.id, 'Padrão', true, true, 0 FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id);

-- ============ custos privados ============
CREATE TABLE public.variant_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id),
  cost_cents integer NOT NULL CHECK (cost_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL',
  effective_from date NOT NULL DEFAULT current_date,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variant_costs_variant_idx ON public.variant_costs (variant_id, effective_from DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.variant_costs TO authenticated;
GRANT ALL ON public.variant_costs TO service_role;
ALTER TABLE public.variant_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_costs_read ON public.variant_costs FOR SELECT TO authenticated USING (public.can_view_costs(auth.uid()));
CREATE POLICY variant_costs_manage ON public.variant_costs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','estoque']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['master','diretoria','financeiro','estoque']::public.app_role[]));

-- ============ exposição de preços ============
-- visitante enxerga apenas colunas seguras; price_cents nunca é lido direto
REVOKE SELECT ON public.products FROM anon;
GRANT SELECT (id, slug, name, category_id, collection_id, short_description, description,
  material, plating, measurements, weight_grams, care_instructions, warranty_text,
  price_is_public, seo_title, seo_description, position, status, published_at, created_at, updated_at)
  ON public.products TO anon;
REVOKE SELECT ON public.product_variants FROM anon;
GRANT SELECT (id, product_id, sku, label, size, color, barcode, position, is_active, is_default, created_at, updated_at)
  ON public.product_variants TO anon;
GRANT SELECT ON public.public_price_list TO anon;

-- ============ updated_at + auditoria ============
CREATE TRIGGER trg_suppliers_updated BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_entities_updated BEFORE UPDATE ON public.business_entities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_variant_costs_updated BEFORE UPDATE ON public.variant_costs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_audit_suppliers AFTER INSERT OR UPDATE OR DELETE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_business_entities AFTER INSERT OR UPDATE OR DELETE ON public.business_entities FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_locations AFTER INSERT OR UPDATE OR DELETE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_variant_costs AFTER INSERT OR UPDATE OR DELETE ON public.variant_costs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
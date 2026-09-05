-- ============================================================
-- LARDAN Cloud — Central de Cadastros (identidade canônica)
-- Evolução aditiva: nada é apagado, tudo é vinculado.
-- ============================================================

CREATE TYPE public.party_kind AS ENUM ('pessoa','organizacao');
CREATE TYPE public.party_status AS ENUM ('rascunho','em_analise','aprovado','ativo','bloqueado','inativo','desligado');
CREATE TYPE public.party_role_kind AS ENUM (
  'candidata','consultora','revendedora','representante','colaborador',
  'cliente','fornecedor','entidade_grupo','transportadora','prestador',
  'custodiante','usuario'
);
CREATE TYPE public.contact_kind AS ENUM ('whatsapp','telefone','email');

CREATE OR REPLACE FUNCTION public.only_digits(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(regexp_replace(COALESCE(_v,''), '\D', '', 'g'), '');
$$;

CREATE SEQUENCE IF NOT EXISTS public.party_code_seq;

-- ---------- identidade central ----------
CREATE TABLE public.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.party_kind NOT NULL,
  code text NOT NULL UNIQUE DEFAULT ('LC-' || lpad(nextval('public.party_code_seq')::text, 6, '0')),
  display_name text,
  legal_name text,
  social_name text,
  doc text,
  doc_digits text,
  doc_verified_at timestamptz,
  rg text,
  rg_issuer text,
  birth_date date,
  profession text,
  marital_status text,
  avatar_url text,
  notes text,
  status public.party_status NOT NULL DEFAULT 'rascunho',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parties_doc_digits_idx ON public.parties (doc_digits) WHERE doc_digits IS NOT NULL;
CREATE INDEX parties_name_trgm_idx ON public.parties USING gin (
  (COALESCE(display_name,'') || ' ' || COALESCE(legal_name,'') || ' ' || COALESCE(social_name,'')) gin_trgm_ops
);
CREATE INDEX parties_kind_status_idx ON public.parties (kind, status);

CREATE TABLE public.party_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  role public.party_role_kind NOT NULL,
  status public.party_status NOT NULL DEFAULT 'ativo',
  started_at date,
  ended_at date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, role)
);
CREATE INDEX party_roles_role_idx ON public.party_roles (role, status);

CREATE TABLE public.contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  kind public.contact_kind NOT NULL,
  label text,
  value text NOT NULL,
  value_norm text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_points_party_idx ON public.contact_points (party_id);
CREATE INDEX contact_points_norm_idx ON public.contact_points (value_norm);

CREATE TABLE public.party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  label text,
  postal_code text,
  street text,
  street_number text,
  no_number boolean NOT NULL DEFAULT false,
  complement text,
  district text,
  city text,
  uf char(2),
  reference text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX party_addresses_party_idx ON public.party_addresses (party_id);

-- vínculo com os registros já existentes: fonte única, sem cópia
CREATE TABLE public.party_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('supplier','business_entity','profile','lead','location','contact_request')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX party_links_party_idx ON public.party_links (party_id);

-- perfil especializado de consultora (mesma pessoa, atributos do papel)
CREATE TABLE public.consultant_profiles (
  party_id uuid PRIMARY KEY REFERENCES public.parties(id) ON DELETE CASCADE,
  origin text,
  joined_at date,
  representative_party_id uuid REFERENCES public.parties(id),
  sponsor_party_id uuid REFERENCES public.parties(id),
  region text,
  wallet text,
  level text,
  goal_cents integer,
  cycle text,
  sale_profile text,
  experience text,
  audience text,
  availability text,
  block_reason text,
  pix_key_type text,
  pix_key text,
  pix_holder text,
  pix_holder_doc text,
  bank_info text,
  credit_limit_cents integer,
  financial_status text,
  restricted_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- ligação com o que já existe ----------
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);
ALTER TABLE public.business_entities ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id);

-- ---------- normalização automática ----------
CREATE OR REPLACE FUNCTION public.parties_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.doc_digits := public.only_digits(NEW.doc);
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN NEW.updated_by := auth.uid(); END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_parties_normalize BEFORE INSERT OR UPDATE ON public.parties
FOR EACH ROW EXECUTE FUNCTION public.parties_normalize();

CREATE OR REPLACE FUNCTION public.contact_points_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.value_norm := CASE WHEN NEW.kind = 'email' THEN lower(btrim(NEW.value))
                         ELSE public.only_digits(NEW.value) END;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_contact_points_normalize BEFORE INSERT OR UPDATE ON public.contact_points
FOR EACH ROW EXECUTE FUNCTION public.contact_points_normalize();

CREATE TRIGGER trg_party_roles_updated BEFORE UPDATE ON public.party_roles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_party_addresses_updated BEFORE UPDATE ON public.party_addresses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_consultant_profiles_updated BEFORE UPDATE ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- auditoria imutável
CREATE TRIGGER trg_audit_parties AFTER INSERT OR UPDATE OR DELETE ON public.parties
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_party_roles AFTER INSERT OR UPDATE OR DELETE ON public.party_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER trg_audit_consultant_profiles AFTER INSERT OR UPDATE OR DELETE ON public.consultant_profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------- permissões ----------
INSERT INTO public.role_capabilities (role, capability)
SELECT r, c FROM unnest(ARRAY['master','diretoria']::public.app_role[]) r,
  unnest(ARRAY['registry.view','registry.manage','registry.doc.view','registry.finance.view']) c
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'suporte'::public.app_role, c FROM unnest(ARRAY['registry.view','registry.manage']) c
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'financeiro'::public.app_role, c FROM unnest(ARRAY['registry.view','registry.doc.view','registry.finance.view']) c
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability)
SELECT 'cobranca'::public.app_role, c FROM unnest(ARRAY['registry.view','registry.finance.view']) c
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability)
SELECT r, 'registry.view' FROM unnest(ARRAY['estoque','marketing']::public.app_role[]) r
ON CONFLICT DO NOTHING;

-- ---------- grants + RLS ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_points TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_profiles TO authenticated;
GRANT ALL ON public.parties, public.party_roles, public.contact_points,
  public.party_addresses, public.party_links, public.consultant_profiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.party_code_seq TO authenticated, service_role;

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY parties_read ON public.parties FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY parties_write ON public.parties FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

CREATE POLICY party_roles_read ON public.party_roles FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY party_roles_write ON public.party_roles FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

CREATE POLICY contact_points_read ON public.contact_points FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY contact_points_write ON public.contact_points FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

CREATE POLICY party_addresses_read ON public.party_addresses FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY party_addresses_write ON public.party_addresses FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

CREATE POLICY party_links_read ON public.party_links FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY party_links_write ON public.party_links FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

CREATE POLICY consultant_profiles_read ON public.consultant_profiles FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));
CREATE POLICY consultant_profiles_write ON public.consultant_profiles FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.manage'))
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage'));

-- ---------- backfill: vincular o que já existe (sem apagar nada) ----------
DO $$
DECLARE r record; pid uuid;
BEGIN
  FOR r IN SELECT * FROM public.suppliers WHERE party_id IS NULL LOOP
    INSERT INTO public.parties (kind, display_name, legal_name, doc, status, is_active, created_at)
    VALUES ('organizacao', COALESCE(r.trade_name, r.name), r.name, r.tax_id,
            CASE WHEN r.is_active THEN 'ativo' ELSE 'inativo' END::public.party_status,
            r.is_active, r.created_at)
    RETURNING id INTO pid;
    UPDATE public.suppliers SET party_id = pid WHERE id = r.id;
    INSERT INTO public.party_links (party_id, entity_type, entity_id) VALUES (pid,'supplier',r.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.party_roles (party_id, role) VALUES (pid,'fornecedor') ON CONFLICT DO NOTHING;
  END LOOP;

  FOR r IN SELECT * FROM public.business_entities WHERE party_id IS NULL LOOP
    INSERT INTO public.parties (kind, display_name, legal_name, doc, status, is_active, created_at)
    VALUES ('organizacao', COALESCE(r.trade_name, r.legal_name), r.legal_name, r.tax_id,
            CASE WHEN r.is_active THEN 'ativo' ELSE 'inativo' END::public.party_status,
            r.is_active, r.created_at)
    RETURNING id INTO pid;
    UPDATE public.business_entities SET party_id = pid WHERE id = r.id;
    INSERT INTO public.party_links (party_id, entity_type, entity_id) VALUES (pid,'business_entity',r.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.party_roles (party_id, role) VALUES (pid,'entidade_grupo') ON CONFLICT DO NOTHING;
  END LOOP;

  FOR r IN SELECT * FROM public.profiles WHERE party_id IS NULL LOOP
    INSERT INTO public.parties (kind, display_name, status, is_active, created_at)
    VALUES ('pessoa', COALESCE(r.display_name, r.full_name),
            CASE WHEN r.is_active THEN 'ativo' ELSE 'inativo' END::public.party_status,
            r.is_active, r.created_at)
    RETURNING id INTO pid;
    UPDATE public.profiles SET party_id = pid WHERE id = r.id;
    INSERT INTO public.party_links (party_id, entity_type, entity_id) VALUES (pid,'profile',r.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.party_roles (party_id, role) VALUES (pid,'colaborador') ON CONFLICT DO NOTHING;
    INSERT INTO public.party_roles (party_id, role) VALUES (pid,'usuario') ON CONFLICT DO NOTHING;
    IF r.email IS NOT NULL THEN
      INSERT INTO public.contact_points (party_id, kind, value, is_primary) VALUES (pid,'email',r.email,true);
    END IF;
    IF r.phone IS NOT NULL THEN
      INSERT INTO public.contact_points (party_id, kind, value, is_primary) VALUES (pid,'whatsapp',r.phone,true);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Busca unificada, contadores e conversão candidata → consultora
-- ============================================================

CREATE OR REPLACE FUNCTION public.mask_doc(_doc text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN public.only_digits(_doc) IS NULL THEN NULL
    WHEN length(public.only_digits(_doc)) = 11 THEN '***.' || substr(public.only_digits(_doc),4,3) || '.' || substr(public.only_digits(_doc),7,3) || '-**'
    WHEN length(public.only_digits(_doc)) = 14 THEN '**.' || substr(public.only_digits(_doc),3,3) || '.' || substr(public.only_digits(_doc),6,3) || '/****-**'
    ELSE repeat('*', greatest(length(public.only_digits(_doc)) - 4, 0)) || right(public.only_digits(_doc), 4)
  END;
$$;

CREATE OR REPLACE FUNCTION public.search_registry(_term text, _limit integer DEFAULT 8)
RETURNS TABLE (
  grupo text, tipo text, entity_id uuid, titulo text, subtitulo text, selo text, rota text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t text := btrim(COALESCE(_term, ''));
  d text := public.only_digits(_term);
  lim integer := least(greatest(COALESCE(_limit, 8), 1), 25);
  ver_doc boolean := public.has_capability(auth.uid(), 'registry.doc.view');
BEGIN
  IF length(t) < 2 THEN RETURN; END IF;

  IF public.has_capability(auth.uid(), 'registry.view') THEN
    RETURN QUERY
    SELECT 'Pessoas e empresas', CASE WHEN p.kind = 'pessoa' THEN 'pessoa' ELSE 'organizacao' END,
           p.id,
           COALESCE(p.display_name, p.legal_name, p.code),
           COALESCE(NULLIF(CASE WHEN ver_doc THEN p.doc ELSE public.mask_doc(p.doc) END, ''), p.code),
           p.status::text,
           '/admin/cadastros/pessoas/' || p.id
    FROM public.parties p
    WHERE p.display_name ILIKE '%' || t || '%'
       OR p.legal_name ILIKE '%' || t || '%'
       OR p.social_name ILIKE '%' || t || '%'
       OR p.code ILIKE '%' || t || '%'
       OR (d IS NOT NULL AND p.doc_digits LIKE '%' || d || '%')
       OR EXISTS (
            SELECT 1 FROM public.contact_points c
            WHERE c.party_id = p.id
              AND (c.value_norm ILIKE '%' || COALESCE(d, lower(t)) || '%' OR c.value ILIKE '%' || t || '%')
          )
    ORDER BY COALESCE(p.display_name, p.legal_name)
    LIMIT lim;
  END IF;

  IF public.has_capability(auth.uid(), 'catalog.view') THEN
    RETURN QUERY
    SELECT 'Catálogo', 'produto', pr.id, pr.name,
           COALESCE(pr.legacy_code, pr.slug), pr.status::text,
           '/admin/cadastros/produtos/' || pr.id
    FROM public.products pr
    WHERE pr.name ILIKE '%' || t || '%' OR pr.slug ILIKE '%' || t || '%'
       OR pr.legacy_code ILIKE '%' || t || '%'
       OR EXISTS (SELECT 1 FROM public.product_variants v
                  WHERE v.product_id = pr.id
                    AND (v.sku ILIKE '%' || t || '%' OR v.barcode ILIKE '%' || t || '%'
                         OR v.legacy_code ILIKE '%' || t || '%'))
    ORDER BY pr.name
    LIMIT lim;

    RETURN QUERY
    SELECT 'Catálogo', 'categoria', c.id, c.name, c.slug, c.status::text,
           '/admin/cadastros/categorias'
    FROM public.categories c WHERE c.name ILIKE '%' || t || '%' OR c.slug ILIKE '%' || t || '%'
    ORDER BY c.name LIMIT lim;

    RETURN QUERY
    SELECT 'Catálogo', 'colecao', c.id, c.name, c.slug, c.status::text,
           '/admin/cadastros/colecoes'
    FROM public.collections c WHERE c.name ILIKE '%' || t || '%' OR c.slug ILIKE '%' || t || '%'
    ORDER BY c.name LIMIT lim;
  END IF;

  IF public.has_capability(auth.uid(), 'partners.view') OR public.has_capability(auth.uid(), 'registry.view') THEN
    RETURN QUERY
    SELECT 'Empresas e parceiros', 'fornecedor', s.id, s.name,
           COALESCE(NULLIF(CASE WHEN ver_doc THEN s.tax_id ELSE public.mask_doc(s.tax_id) END,''), COALESCE(s.city,'—')),
           CASE WHEN s.is_active THEN 'ativo' ELSE 'inativo' END,
           '/admin/cadastros/fornecedores'
    FROM public.suppliers s
    WHERE s.name ILIKE '%' || t || '%' OR s.trade_name ILIKE '%' || t || '%'
       OR (d IS NOT NULL AND public.only_digits(s.tax_id) LIKE '%' || d || '%')
    ORDER BY s.name LIMIT lim;

    RETURN QUERY
    SELECT 'Empresas e parceiros', 'entidade', b.id, b.legal_name,
           COALESCE(b.trade_name, b.city, '—'),
           CASE WHEN b.is_active THEN 'ativo' ELSE 'inativo' END,
           '/admin/cadastros/entidades'
    FROM public.business_entities b
    WHERE b.legal_name ILIKE '%' || t || '%' OR b.trade_name ILIKE '%' || t || '%'
       OR (d IS NOT NULL AND public.only_digits(b.tax_id) LIKE '%' || d || '%')
    ORDER BY b.legal_name LIMIT lim;
  END IF;

  IF public.has_capability(auth.uid(), 'stock.view') OR public.has_capability(auth.uid(), 'registry.view') THEN
    RETURN QUERY
    SELECT 'Estrutura operacional', 'local', l.id, l.name, l.code, l.kind::text,
           '/admin/cadastros/locais'
    FROM public.locations l
    WHERE l.name ILIKE '%' || t || '%' OR l.code ILIKE '%' || t || '%'
    ORDER BY l.name LIMIT lim;
  END IF;

  IF public.has_capability(auth.uid(), 'leads.view') THEN
    RETURN QUERY
    SELECT 'Candidaturas', 'candidatura', le.id, le.full_name,
           le.protocol, le.status::text, '/admin/leads'
    FROM public.leads le
    WHERE le.full_name ILIKE '%' || t || '%' OR le.protocol ILIKE '%' || t || '%'
       OR (d IS NOT NULL AND public.only_digits(le.whatsapp) LIKE '%' || d || '%')
    ORDER BY le.created_at DESC LIMIT lim;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.search_registry(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_registry(text, integer) TO authenticated, service_role;

-- contadores reais da Central (zero é zero)
CREATE OR REPLACE FUNCTION public.registry_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RETURN '{}'::jsonb;
  END IF;
  SELECT jsonb_build_object(
    'pessoas', (SELECT count(*) FROM public.parties WHERE kind = 'pessoa'),
    'organizacoes', (SELECT count(*) FROM public.parties WHERE kind = 'organizacao'),
    'ativos', (SELECT count(*) FROM public.parties WHERE status = 'ativo'),
    'rascunhos', (SELECT count(*) FROM public.parties WHERE status = 'rascunho'),
    'incompletos', (SELECT count(*) FROM public.parties
                    WHERE display_name IS NULL OR btrim(COALESCE(display_name,'')) = ''
                       OR doc_digits IS NULL
                       OR NOT EXISTS (SELECT 1 FROM public.contact_points c WHERE c.party_id = parties.id)),
    'duplicidades', (SELECT count(*) FROM (
                       SELECT doc_digits FROM public.parties
                       WHERE doc_digits IS NOT NULL GROUP BY doc_digits HAVING count(*) > 1) x),
    'atualizados_7d', (SELECT count(*) FROM public.parties WHERE updated_at > now() - interval '7 days'),
    'consultoras', (SELECT count(*) FROM public.party_roles WHERE role = 'consultora'),
    'representantes', (SELECT count(*) FROM public.party_roles WHERE role = 'representante'),
    'revendedoras', (SELECT count(*) FROM public.party_roles WHERE role = 'revendedora'),
    'clientes', (SELECT count(*) FROM public.party_roles WHERE role = 'cliente'),
    'colaboradores', (SELECT count(*) FROM public.party_roles WHERE role = 'colaborador'),
    'fornecedores', (SELECT count(*) FROM public.suppliers),
    'entidades', (SELECT count(*) FROM public.business_entities),
    'locais', (SELECT count(*) FROM public.locations),
    'produtos', (SELECT count(*) FROM public.products),
    'variantes', (SELECT count(*) FROM public.product_variants),
    'categorias', (SELECT count(*) FROM public.categories),
    'colecoes', (SELECT count(*) FROM public.collections),
    'candidaturas', (SELECT count(*) FROM public.leads),
    'usuarios', (SELECT count(*) FROM public.profiles)
  ) INTO res;
  RETURN res;
END; $$;

REVOKE ALL ON FUNCTION public.registry_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry_counts() TO authenticated, service_role;

-- possíveis duplicidades: nunca funde automaticamente, apenas aponta
CREATE OR REPLACE FUNCTION public.registry_duplicates(_limit integer DEFAULT 50)
RETURNS TABLE (motivo text, chave text, quantidade bigint, ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'documento', doc_digits, count(*), array_agg(id ORDER BY created_at)
  FROM public.parties
  WHERE public.has_capability(auth.uid(), 'registry.view') AND doc_digits IS NOT NULL
  GROUP BY doc_digits HAVING count(*) > 1
  UNION ALL
  SELECT 'contato', c.value_norm, count(DISTINCT c.party_id), array_agg(DISTINCT c.party_id)
  FROM public.contact_points c
  WHERE public.has_capability(auth.uid(), 'registry.view') AND c.value_norm IS NOT NULL
  GROUP BY c.value_norm HAVING count(DISTINCT c.party_id) > 1
  LIMIT least(greatest(COALESCE(_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.registry_duplicates(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry_duplicates(integer) TO authenticated, service_role;

-- conversão transacional e idempotente de candidatura em consultora
CREATE OR REPLACE FUNCTION public.convert_lead_to_consultant(_lead_id uuid, _party_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE le public.leads; pid uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.manage') THEN
    RAISE EXCEPTION 'sem permissão para converter candidaturas';
  END IF;

  SELECT * INTO le FROM public.leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidatura não encontrada'; END IF;

  IF le.party_id IS NOT NULL THEN
    INSERT INTO public.party_roles (party_id, role, created_by)
    VALUES (le.party_id, 'consultora', auth.uid()) ON CONFLICT DO NOTHING;
    INSERT INTO public.consultant_profiles (party_id) VALUES (le.party_id) ON CONFLICT DO NOTHING;
    RETURN le.party_id;
  END IF;

  IF _party_id IS NOT NULL THEN
    SELECT id INTO pid FROM public.parties WHERE id = _party_id;
    IF pid IS NULL THEN RAISE EXCEPTION 'pessoa informada não existe'; END IF;
  ELSE
    INSERT INTO public.parties (kind, display_name, status, created_by)
    VALUES ('pessoa', le.full_name, 'em_analise', auth.uid())
    RETURNING id INTO pid;

    INSERT INTO public.contact_points (party_id, kind, value, is_primary)
    VALUES (pid, 'whatsapp', le.whatsapp, true);

    INSERT INTO public.party_addresses (party_id, label, postal_code, street, street_number, no_number, city, uf, is_primary)
    VALUES (pid, 'Principal', le.postal_code, le.street, le.street_number, le.no_number, le.city, le.uf, true);
  END IF;

  INSERT INTO public.party_roles (party_id, role, status, started_at, created_by)
  VALUES (pid, 'candidata', 'aprovado', current_date, auth.uid()) ON CONFLICT DO NOTHING;
  INSERT INTO public.party_roles (party_id, role, status, started_at, created_by)
  VALUES (pid, 'consultora', 'ativo', current_date, auth.uid()) ON CONFLICT DO NOTHING;

  INSERT INTO public.consultant_profiles (party_id, origin, joined_at, experience, audience, availability)
  VALUES (pid, COALESCE(le.source, 'Seja Lardan'), current_date, le.experience, le.audience, le.availability)
  ON CONFLICT (party_id) DO NOTHING;

  UPDATE public.leads SET party_id = pid, status = 'aprovado', updated_at = now() WHERE id = _lead_id;

  INSERT INTO public.party_links (party_id, entity_type, entity_id)
  VALUES (pid, 'lead', _lead_id) ON CONFLICT DO NOTHING;

  INSERT INTO public.lead_events (lead_id, event_type, note, actor_id)
  VALUES (_lead_id, 'conversao', 'Convertida em consultora (pessoa ' || pid::text || ')', auth.uid());

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'registry.convert_lead', 'parties', pid::text,
          jsonb_build_object('lead_id', _lead_id, 'protocol', le.protocol));

  RETURN pid;
END; $$;

REVOKE ALL ON FUNCTION public.convert_lead_to_consultant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_consultant(uuid, uuid) TO authenticated, service_role;
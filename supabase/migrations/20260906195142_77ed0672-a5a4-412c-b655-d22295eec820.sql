-- =====================================================================
-- LARDAN — Campos inteligentes e APIs Brasil (lote aditivo)
-- Inventário prévio: 159 parties (0 com documento), 1 contato, 0 endereços.
-- Nenhum valor legado problemático; nada é apagado.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.doc_canon(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(regexp_replace(upper(coalesce(v,'')), '[^0-9A-Z]', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION public.cnpj_is_valid(c text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE dvs text; s int; r int; i int; pesos int[];
BEGIN
  IF c IS NULL OR length(c) <> 14 THEN RETURN false; END IF;
  IF c !~ '^[0-9A-Z]{12}[0-9]{2}$' THEN RETURN false; END IF;
  IF c ~ '^(.)\1{13}$' THEN RETURN false; END IF;
  dvs := substr(c,13,2);

  pesos := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0;
  FOR i IN 1..12 LOOP s := s + (ascii(substr(c,i,1)) - 48) * pesos[i]; END LOOP;
  r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  IF r <> substr(dvs,1,1)::int THEN RETURN false; END IF;

  pesos := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0;
  FOR i IN 1..13 LOOP s := s + (ascii(substr(c,i,1)) - 48) * pesos[i]; END LOOP;
  r := s % 11; r := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  RETURN r = substr(dvs,2,1)::int;
END $$;

CREATE OR REPLACE FUNCTION public.cpf_is_valid(d text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s int; r int; i int;
BEGIN
  IF d IS NULL OR d !~ '^[0-9]{11}$' THEN RETURN false; END IF;
  IF d ~ '^(\d)\1{10}$' THEN RETURN false; END IF;
  s := 0;
  FOR i IN 1..9 LOOP s := s + substr(d,i,1)::int * (11 - i); END LOOP;
  r := (s * 10) % 11; r := CASE WHEN r = 10 THEN 0 ELSE r END;
  IF r <> substr(d,10,1)::int THEN RETURN false; END IF;
  s := 0;
  FOR i IN 1..10 LOOP s := s + substr(d,i,1)::int * (12 - i); END LOOP;
  r := (s * 10) % 11; r := CASE WHEN r = 10 THEN 0 ELSE r END;
  RETURN r = substr(d,11,1)::int;
END $$;

DROP FUNCTION IF EXISTS public.doc_is_valid(text);
CREATE FUNCTION public.doc_is_valid(v text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c text;
BEGIN
  c := public.doc_canon(v);
  IF c IS NULL THEN RETURN true; END IF;
  IF length(c) = 11 THEN RETURN public.cpf_is_valid(c); END IF;
  IF length(c) = 14 THEN RETURN public.cnpj_is_valid(c); END IF;
  RETURN false;
END $$;

ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS doc_canon text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS doc_source text;
ALTER TABLE public.parties ADD COLUMN IF NOT EXISTS doc_checked_at timestamptz;

UPDATE public.parties SET doc_canon = public.doc_canon(doc)
WHERE doc IS NOT NULL AND doc_canon IS NULL;

CREATE OR REPLACE FUNCTION public.parties_privacy_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.doc_canon  := public.doc_canon(NEW.doc);
  NEW.doc_digits := nullif(regexp_replace(coalesce(NEW.doc,''), '\D', '', 'g'), '');
  IF NEW.doc_canon IS NOT NULL AND NOT public.doc_is_valid(NEW.doc_canon) THEN
    RAISE EXCEPTION 'Documento inválido: CPF/CNPJ com dígitos verificadores incoerentes.';
  END IF;
  IF NEW.doc_canon IS NOT NULL THEN NEW.doc := NEW.doc_canon; END IF;
  NEW.doc_masked := public.mask_doc(NEW.doc);
  RETURN NEW;
END $$;

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_doc_canon_ck;
ALTER TABLE public.parties ADD CONSTRAINT parties_doc_canon_ck
  CHECK (doc_canon IS NULL OR (doc_canon ~ '^[0-9A-Z]+$' AND length(doc_canon) IN (11,14)));

CREATE INDEX IF NOT EXISTS parties_doc_canon_idx
  ON public.parties (doc_canon) WHERE doc_canon IS NOT NULL;

GRANT SELECT (doc_canon) ON public.parties TO authenticated;

-- ---------- Contatos: canônico E.164 ----------

CREATE OR REPLACE FUNCTION public.phone_canon(v text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(v,''), '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF length(d) > 11 AND left(d,2) = '55' THEN d := substr(d,3); END IF;
  IF length(d) NOT IN (10,11) THEN RETURN NULL; END IF;
  RETURN '+55' || d;
END $$;

CREATE OR REPLACE FUNCTION public.contact_points_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE canon text;
BEGIN
  IF NEW.kind = 'email' THEN
    NEW.value := lower(btrim(NEW.value));
    NEW.value_norm := nullif(NEW.value, '');
    IF NEW.value <> '' AND NEW.value !~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$' THEN
      RAISE EXCEPTION 'E-mail em formato inválido.';
    END IF;
  ELSE
    canon := public.phone_canon(NEW.value);
    IF btrim(coalesce(NEW.value,'')) <> '' AND canon IS NULL THEN
      RAISE EXCEPTION 'Telefone inválido: informe DDD + número (8 ou 9 dígitos).';
    END IF;
    IF canon IS NOT NULL THEN NEW.value := canon; END IF;
    NEW.value_norm := canon;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

UPDATE public.contact_points
   SET value_norm = CASE WHEN kind = 'email' THEN nullif(lower(btrim(value)),'')
                         ELSE public.phone_canon(value) END
 WHERE value_norm IS DISTINCT FROM (CASE WHEN kind = 'email' THEN nullif(lower(btrim(value)),'')
                                         ELSE public.phone_canon(value) END);

ALTER TABLE public.contact_points DROP CONSTRAINT IF EXISTS contact_points_canon_ck;
ALTER TABLE public.contact_points ADD CONSTRAINT contact_points_canon_ck
  CHECK (
    value_norm IS NULL
    OR (kind = 'email' AND value_norm ~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$')
    OR (kind <> 'email' AND value_norm ~ '^\+55[0-9]{10,11}$')
  );

-- ---------- Endereço ----------

ALTER TABLE public.party_addresses
  ADD COLUMN IF NOT EXISTS ibge_city_code text,
  ADD COLUMN IF NOT EXISTS ddd text,
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'BR',
  ADD COLUMN IF NOT EXISTS address_source text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

UPDATE public.party_addresses
   SET postal_code = nullif(regexp_replace(coalesce(postal_code,''), '\D', '', 'g'), '')
 WHERE postal_code IS NOT NULL;

ALTER TABLE public.party_addresses DROP CONSTRAINT IF EXISTS party_addresses_cep_ck;
ALTER TABLE public.party_addresses ADD CONSTRAINT party_addresses_cep_ck
  CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{8}$');

ALTER TABLE public.party_addresses DROP CONSTRAINT IF EXISTS party_addresses_uf_ck;
ALTER TABLE public.party_addresses ADD CONSTRAINT party_addresses_uf_ck
  CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');

ALTER TABLE public.party_addresses DROP CONSTRAINT IF EXISTS party_addresses_ibge_ck;
ALTER TABLE public.party_addresses ADD CONSTRAINT party_addresses_ibge_ck
  CHECK (ibge_city_code IS NULL OR ibge_city_code ~ '^[0-9]{7}$');

ALTER TABLE public.party_addresses DROP CONSTRAINT IF EXISTS party_addresses_len_ck;
ALTER TABLE public.party_addresses ADD CONSTRAINT party_addresses_len_ck
  CHECK (
    coalesce(length(street),0) <= 120 AND
    coalesce(length(street_number),0) <= 12 AND
    coalesce(length(complement),0) <= 80 AND
    coalesce(length(district),0) <= 80 AND
    coalesce(length(city),0) <= 80 AND
    coalesce(length(reference),0) <= 160
  );

CREATE OR REPLACE FUNCTION public.party_addresses_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.postal_code := nullif(regexp_replace(coalesce(NEW.postal_code,''), '\D', '', 'g'), '');
  NEW.uf := nullif(upper(btrim(coalesce(NEW.uf,''))), '');
  NEW.ibge_city_code := nullif(regexp_replace(coalesce(NEW.ibge_city_code,''), '\D', '', 'g'), '');
  NEW.ddd := nullif(regexp_replace(coalesce(NEW.ddd,''), '\D', '', 'g'), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_party_addresses_normalize ON public.party_addresses;
CREATE TRIGGER trg_party_addresses_normalize
BEFORE INSERT OR UPDATE ON public.party_addresses
FOR EACH ROW EXECUTE FUNCTION public.party_addresses_normalize();

-- ---------- Municípios IBGE ----------

CREATE TABLE IF NOT EXISTS public.ibge_municipios (
  codigo_ibge text PRIMARY KEY,
  uf text NOT NULL,
  nome text NOT NULL,
  nome_norm text GENERATED ALWAYS AS (lower(nome)) STORED,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ibge_municipios_uf_idx ON public.ibge_municipios (uf, nome);

GRANT SELECT ON public.ibge_municipios TO authenticated;
GRANT ALL ON public.ibge_municipios TO service_role;
ALTER TABLE public.ibge_municipios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ibge_municipios_read ON public.ibge_municipios;
CREATE POLICY ibge_municipios_read ON public.ibge_municipios
  FOR SELECT TO authenticated USING (true);

-- ---------- Cache de integrações (somente servidor) ----------

CREATE TABLE IF NOT EXISTS public.integration_cache (
  provider text NOT NULL,
  chave text NOT NULL,
  payload jsonb NOT NULL,
  response_hash text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, chave)
);

GRANT ALL ON public.integration_cache TO service_role;
ALTER TABLE public.integration_cache ENABLE ROW LEVEL SECURITY;

-- ---------- Auditoria das consultas externas ----------

CREATE TABLE IF NOT EXISTS public.integration_lookups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  kind text NOT NULL,
  referencia text,
  status text NOT NULL,
  http_status int,
  latency_ms int,
  cache_hit boolean NOT NULL DEFAULT false,
  error_code text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_lookups_recent_idx
  ON public.integration_lookups (created_at DESC);
CREATE INDEX IF NOT EXISTS integration_lookups_user_idx
  ON public.integration_lookups (user_id, created_at DESC);

GRANT SELECT ON public.integration_lookups TO authenticated;
GRANT ALL ON public.integration_lookups TO service_role;
ALTER TABLE public.integration_lookups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_lookups_read ON public.integration_lookups;
CREATE POLICY integration_lookups_read ON public.integration_lookups
  FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'audit.view'));

-- ---------- Dados externos aplicados ----------

CREATE TABLE IF NOT EXISTS public.external_data_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid REFERENCES public.parties(id) ON DELETE CASCADE,
  provider text NOT NULL,
  identifier text NOT NULL,
  mapping_version text NOT NULL DEFAULT 'v1',
  response_hash text,
  applied_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS external_data_applications_party_idx
  ON public.external_data_applications (party_id, applied_at DESC);

GRANT SELECT, INSERT ON public.external_data_applications TO authenticated;
GRANT ALL ON public.external_data_applications TO service_role;
ALTER TABLE public.external_data_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_data_applications_read ON public.external_data_applications;
CREATE POLICY external_data_applications_read ON public.external_data_applications
  FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'registry.view'));

DROP POLICY IF EXISTS external_data_applications_write ON public.external_data_applications;
CREATE POLICY external_data_applications_write ON public.external_data_applications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(auth.uid(), 'registry.manage') AND applied_by = auth.uid());

-- ---------- Saúde real das integrações ----------

CREATE OR REPLACE FUNCTION public.integration_health()
RETURNS TABLE (
  provider text,
  total_24h bigint,
  sucessos_24h bigint,
  erros_24h bigint,
  cache_hits_24h bigint,
  latencia_media_ms numeric,
  ultima_ok timestamptz,
  ultimo_erro timestamptz,
  ultimo_erro_codigo text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.provider,
         count(*),
         count(*) FILTER (WHERE l.status = 'ok'),
         count(*) FILTER (WHERE l.status NOT IN ('ok','nao_encontrado')),
         count(*) FILTER (WHERE l.cache_hit),
         round(avg(l.latency_ms) FILTER (WHERE l.latency_ms IS NOT NULL), 0),
         max(l.created_at) FILTER (WHERE l.status = 'ok'),
         max(l.created_at) FILTER (WHERE l.status NOT IN ('ok','nao_encontrado')),
         (array_agg(l.error_code ORDER BY l.created_at DESC)
            FILTER (WHERE l.error_code IS NOT NULL))[1]
    FROM public.integration_lookups l
   WHERE l.created_at > now() - interval '24 hours'
     AND public.has_capability(auth.uid(), 'audit.view')
   GROUP BY l.provider
$$;

REVOKE ALL ON FUNCTION public.integration_health() FROM public;
GRANT EXECUTE ON FUNCTION public.integration_health() TO authenticated;
-- =========================================================
-- LARDAN Cloud — Importação Industrial v2 (fundação)
-- =========================================================

-- ---------- normalização de nome (dedupe por acento/caixa/espaço) ----------
CREATE OR REPLACE FUNCTION public.norm_name(_v text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      lower(translate(coalesce(_v,''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
      '\s+', ' ', 'g'),
    '')
$$;
ALTER FUNCTION public.norm_name(text) SET search_path = public;

-- ---------- arquivo recebido (identidade canônica) ----------
CREATE TABLE public.import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL,
  file_name text NOT NULL,
  byte_size bigint NOT NULL DEFAULT 0,
  content_type text,
  row_count integer NOT NULL DEFAULT 0,
  column_count integer NOT NULL DEFAULT 0,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  header_hash text,
  parser_version text NOT NULL DEFAULT 'xlsx-1',
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_files_sha_ck CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX import_files_sha_uidx ON public.import_files (sha256);
GRANT SELECT, INSERT ON public.import_files TO authenticated;
GRANT ALL ON public.import_files TO service_role;
ALTER TABLE public.import_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipe ve arquivos" ON public.import_files FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE POLICY "importadores registram arquivos" ON public.import_files FOR INSERT TO authenticated
  WITH CHECK (public.has_capability(auth.uid(),'imports.run'));

-- ---------- execução (lote) ----------
ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS file_id uuid REFERENCES public.import_files(id),
  ADD COLUMN IF NOT EXISTS rules_version text NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.import_templates(id),
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS simulation_of uuid REFERENCES public.import_jobs(id),
  ADD COLUMN IF NOT EXISTS correction_of uuid REFERENCES public.import_jobs(id),
  ADD COLUMN IF NOT EXISTS worker_token uuid,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS checkpoint_line integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS simulated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS base_fingerprint text;

UPDATE public.import_jobs SET status='falhou' WHERE status='erro';

ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_ck;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_status_ck CHECK (status IN (
  'rascunho','recebendo','recebido','validando','pronto','simulando','simulado',
  'processando','pausando','pausado','concluido','concluido_com_erros','falhou','cancelado'));

CREATE INDEX IF NOT EXISTS import_jobs_file_idx ON public.import_jobs (file_id, created_at DESC);

-- ---------- transições permitidas ----------
CREATE OR REPLACE FUNCTION public.import_state_can(_de text, _para text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _de = _para THEN true
    WHEN _de = 'rascunho'    THEN _para IN ('recebendo','cancelado','falhou')
    WHEN _de = 'recebendo'   THEN _para IN ('recebido','cancelado','falhou')
    WHEN _de = 'recebido'    THEN _para IN ('validando','cancelado','falhou')
    WHEN _de = 'validando'   THEN _para IN ('pronto','validando','cancelado','falhou')
    WHEN _de = 'pronto'      THEN _para IN ('simulando','processando','cancelado','falhou')
    WHEN _de = 'simulando'   THEN _para IN ('simulado','cancelado','falhou')
    WHEN _de = 'simulado'    THEN _para IN ('processando','cancelado')
    WHEN _de = 'processando' THEN _para IN ('pausando','concluido','concluido_com_erros','falhou','cancelado')
    WHEN _de = 'pausando'    THEN _para IN ('pausado','processando','cancelado')
    WHEN _de = 'pausado'     THEN _para IN ('processando','cancelado')
    WHEN _de = 'falhou'      THEN _para IN ('processando','cancelado')
    ELSE false  -- concluido, concluido_com_erros e cancelado são terminais
  END
$$;
ALTER FUNCTION public.import_state_can(text,text) SET search_path = public;

CREATE OR REPLACE FUNCTION public.import_jobs_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.import_state_can(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Transição inválida do lote: % → %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('rascunho','recebendo','recebido') THEN
    IF NEW.mapping IS DISTINCT FROM OLD.mapping THEN
      RAISE EXCEPTION 'O de-para não pode mudar depois que o lote começou.' USING ERRCODE='check_violation';
    END IF;
    IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
      RAISE EXCEPTION 'O local de estoque não pode mudar depois que o lote começou.' USING ERRCODE='check_violation';
    END IF;
    IF NEW.mode IS DISTINCT FROM OLD.mode THEN
      RAISE EXCEPTION 'O modo do lote não pode mudar depois que o lote começou.' USING ERRCODE='check_violation';
    END IF;
    IF NEW.dry_run IS DISTINCT FROM OLD.dry_run THEN
      RAISE EXCEPTION 'Simulação não vira execução real: crie a execução a partir dela.' USING ERRCODE='check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_import_jobs_guard ON public.import_jobs;
CREATE TRIGGER trg_import_jobs_guard BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.import_jobs_guard();

-- ---------- linhas ----------
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS claimed_by uuid,
  ADD COLUMN IF NOT EXISTS claim_until timestamptz,
  ADD COLUMN IF NOT EXISTS effects jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publish_status text,
  ADD COLUMN IF NOT EXISTS error_code text;

ALTER TABLE public.import_rows DROP CONSTRAINT IF EXISTS import_rows_status_ck;
ALTER TABLE public.import_rows ADD CONSTRAINT import_rows_status_ck CHECK (status IN (
  'pendente','valido','aviso','erro','conflito','processando','processado','simulado','ignorado'));

CREATE INDEX IF NOT EXISTS import_rows_claim_idx
  ON public.import_rows (job_id, status, claim_until, line_no);

CREATE OR REPLACE FUNCTION public.import_rows_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM public.import_jobs WHERE id = NEW.job_id;
  IF st IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF TG_OP = 'INSERT' AND st NOT IN ('rascunho','recebendo') THEN
    RAISE EXCEPTION 'Este lote não aceita mais linhas (situação: %).', st USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_import_rows_guard ON public.import_rows;
CREATE TRIGGER trg_import_rows_guard BEFORE INSERT ON public.import_rows
  FOR EACH ROW EXECUTE FUNCTION public.import_rows_guard();

-- ---------- identidade canônica: nada duplica por acento/caixa ----------
CREATE UNIQUE INDEX IF NOT EXISTS categories_norm_name_uidx
  ON public.categories (public.norm_name(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collections_norm_name_uidx
  ON public.collections (public.norm_name(name));
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_norm_name_uidx
  ON public.suppliers (public.norm_name(name));
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_legacy_uidx
  ON public.product_variants (upper(legacy_code)) WHERE legacy_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_legacy_uidx
  ON public.products (upper(legacy_code)) WHERE legacy_code IS NOT NULL;

-- ---------- indicadores calculados a partir dos fatos ----------
CREATE OR REPLACE FUNCTION public.import_job_counters(_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT jsonb_build_object(
    'total',        count(*),
    'pendentes',    count(*) FILTER (WHERE status='pendente'),
    'prontas',      count(*) FILTER (WHERE status='valido'),
    'avisos',       count(*) FILTER (WHERE status='aviso'),
    'recusadas',    count(*) FILTER (WHERE status='erro'),
    'conflitos',    count(*) FILTER (WHERE status='conflito'),
    'em_curso',     count(*) FILTER (WHERE status='processando'),
    'simuladas',    count(*) FILTER (WHERE status='simulado'),
    'processadas',  count(*) FILTER (WHERE status='processado'),
    'ignoradas',    count(*) FILTER (WHERE status='ignorado'),
    'produtos_criados',     count(*) FILTER (WHERE effects->>'produto'='criado'),
    'produtos_atualizados', count(*) FILTER (WHERE effects->>'produto'='atualizado'),
    'variantes_criadas',    count(*) FILTER (WHERE effects->>'variante'='criada'),
    'variantes_atualizadas',count(*) FILTER (WHERE effects->>'variante'='atualizada'),
    'categorias_criadas',   count(*) FILTER (WHERE (effects->>'categoria_criada')::boolean),
    'colecoes_criadas',     count(*) FILTER (WHERE (effects->>'colecao_criada')::boolean),
    'fornecedores_criados', count(*) FILTER (WHERE (effects->>'fornecedor_criado')::boolean),
    'custos',       count(*) FILTER (WHERE (effects->>'custo')::boolean),
    'entradas',     count(*) FILTER (WHERE movement_id IS NOT NULL),
    'unidades',     coalesce(sum(coalesce((effects->>'unidades')::int,0)),0),
    'publicacoes',  count(*) FILTER (WHERE publish_status='publicado'),
    'publicacoes_recusadas', count(*) FILTER (WHERE publish_status='recusada')
  ) INTO res FROM public.import_rows WHERE job_id = _job;
  RETURN coalesce(res, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.import_job_counters(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_counters(uuid) TO authenticated;
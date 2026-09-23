-- ============================================================
-- Preços: versionamento real (aditivo e idempotente)
-- Nada aqui aplica percentual, nem a proporção de "um terço".
-- ============================================================

ALTER TABLE public.pricing_policies
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.pricing_policies(id),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_policies_vigencia_ck') THEN
    ALTER TABLE public.pricing_policies
      ADD CONSTRAINT pricing_policies_vigencia_ck
      CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_policies_percent_ck') THEN
    ALTER TABLE public.pricing_policies
      ADD CONSTRAINT pricing_policies_percent_ck
      CHECK (percent IS NULL OR (percent > 0 AND percent <= 1000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_policies_currency_ck') THEN
    ALTER TABLE public.pricing_policies
      ADD CONSTRAINT pricing_policies_currency_ck CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

-- Uma regra vigente por escopo e por período; aprovada vira histórico.
CREATE OR REPLACE FUNCTION public.pricing_policy_versioning_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE conflito integer;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
    IF NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.percent IS DISTINCT FROM OLD.percent
       OR NEW.basis IS DISTINCT FROM OLD.basis
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.precision_digits IS DISTINCT FROM OLD.precision_digits
       OR NEW.rounding IS DISTINCT FROM OLD.rounding
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
       OR NEW.fundamento IS DISTINCT FROM OLD.fundamento
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'Regra de preço aprovada é histórico: encerre por nova versão em vez de reescrever.';
    END IF;
    IF OLD.status = 'encerrada' AND NEW.status <> 'encerrada' THEN
      RAISE EXCEPTION 'Regra encerrada não volta a vigorar; crie uma nova versão.';
    END IF;
  END IF;

  IF NEW.status = 'vigente' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'Uma regra só vigora com aprovador e data de aprovação registrados.';
    END IF;
    SELECT count(*) INTO conflito
      FROM public.pricing_policies p
     WHERE p.id <> NEW.id
       AND p.scope = NEW.scope
       AND p.status = 'vigente'
       AND daterange(p.valid_from, p.valid_to, '[]')
           && daterange(NEW.valid_from, NEW.valid_to, '[]');
    IF conflito > 0 THEN
      RAISE EXCEPTION 'Já existe regra vigente para % com vigência sobreposta.', NEW.scope;
    END IF;
  END IF;

  IF NEW.status = 'encerrada' AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  NEW.content_hash := md5(concat_ws('|', NEW.scope, NEW.basis, NEW.percent::text,
    NEW.currency, NEW.precision_digits::text, NEW.rounding, NEW.valid_from::text,
    NEW.valid_to::text, NEW.fundamento));
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS pricing_policy_versioning_guard ON public.pricing_policies;
CREATE TRIGGER pricing_policy_versioning_guard BEFORE INSERT OR UPDATE ON public.pricing_policies
  FOR EACH ROW EXECUTE FUNCTION public.pricing_policy_versioning_guard();

-- ---------------- preços por variante ----------------
ALTER TABLE public.variant_price_points
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'padrao',
  ADD COLUMN IF NOT EXISTS value_kind text NOT NULL DEFAULT 'informado',
  ADD COLUMN IF NOT EXISTS precision_digits integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS rounding text NOT NULL DEFAULT 'half_up',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.variant_price_points(id),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_price_points_valuekind_ck') THEN
    ALTER TABLE public.variant_price_points
      ADD CONSTRAINT variant_price_points_valuekind_ck
      CHECK (value_kind IN ('informado','calculado','aprovado'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_price_points_rounding_ck') THEN
    ALTER TABLE public.variant_price_points
      ADD CONSTRAINT variant_price_points_rounding_ck
      CHECK (rounding IN ('half_up','half_even','down','up'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_price_points_vigencia_ck') THEN
    ALTER TABLE public.variant_price_points
      ADD CONSTRAINT variant_price_points_vigencia_ck
      CHECK (valid_to IS NULL OR valid_to >= valid_from);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variant_price_points_currency_ck') THEN
    ALTER TABLE public.variant_price_points
      ADD CONSTRAINT variant_price_points_currency_ck CHECK (currency ~ '^[A-Z]{3}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.variant_price_point_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE conflito integer; pol record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
    IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.variant_id IS DISTINCT FROM OLD.variant_id
       OR NEW.context IS DISTINCT FROM OLD.context
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from THEN
      RAISE EXCEPTION 'Preço aprovado é histórico: encerre por nova versão em vez de reescrever.';
    END IF;
  END IF;

  -- Valor fiscal nunca é derivado automaticamente do preço ao consumidor.
  IF NEW.kind = 'fiscal' AND NEW.value_kind = 'calculado' THEN
    SELECT * INTO pol FROM public.pricing_policies WHERE id = NEW.policy_id;
    IF pol.id IS NULL OR pol.status <> 'vigente' OR pol.percent IS NULL THEN
      RAISE EXCEPTION 'Valor fiscal calculado exige política fiscal vigente com percentual aprovado. A proporção de "um terço" continua pendente e sem efeito.';
    END IF;
  END IF;

  IF NEW.approved_at IS NOT NULL AND NEW.closed_at IS NULL THEN
    SELECT count(*) INTO conflito
      FROM public.variant_price_points v
     WHERE v.id <> NEW.id
       AND v.variant_id = NEW.variant_id
       AND v.kind = NEW.kind
       AND v.context = NEW.context
       AND v.approved_at IS NOT NULL
       AND v.closed_at IS NULL
       AND daterange(v.valid_from, v.valid_to, '[]') && daterange(NEW.valid_from, NEW.valid_to, '[]');
    IF conflito > 0 THEN
      RAISE EXCEPTION 'Já existe preço vigente para esta variante, natureza e contexto no período.';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS variant_price_point_guard ON public.variant_price_points;
CREATE TRIGGER variant_price_point_guard BEFORE INSERT OR UPDATE ON public.variant_price_points
  FOR EACH ROW EXECUTE FUNCTION public.variant_price_point_guard();

-- Snapshot do preço usado por uma operação (acerto, documento fiscal, título).
CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  kind text NOT NULL CHECK (kind IN ('custo','consumidor','lardan_consultora','fiscal')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL',
  precision_digits integer NOT NULL DEFAULT 2,
  rounding text NOT NULL DEFAULT 'half_up',
  price_point_id uuid REFERENCES public.variant_price_points(id),
  policy_id uuid REFERENCES public.pricing_policies(id),
  policy_hash text,
  origem text NOT NULL,
  origem_id uuid,
  taken_at timestamptz NOT NULL DEFAULT now(),
  taken_by uuid
);
CREATE INDEX IF NOT EXISTS price_snapshots_origem_idx ON public.price_snapshots (origem, origem_id);
GRANT SELECT ON public.price_snapshots TO authenticated;
GRANT ALL ON public.price_snapshots TO service_role;
ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_snapshots_read ON public.price_snapshots;
CREATE POLICY price_snapshots_read ON public.price_snapshots FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view') OR public.has_capability(auth.uid(),'catalog.cost.view'));

CREATE OR REPLACE FUNCTION public.price_snapshot_block()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  RAISE EXCEPTION 'Snapshot de preço é histórico imutável.';
END $fn$;
DROP TRIGGER IF EXISTS price_snapshot_block ON public.price_snapshots;
CREATE TRIGGER price_snapshot_block BEFORE UPDATE OR DELETE ON public.price_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.price_snapshot_block();

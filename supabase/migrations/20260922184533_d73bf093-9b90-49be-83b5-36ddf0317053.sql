-- ============================================================
-- Preços versionados, fiscal preparado e base do Asaas (inativos)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('custo','consumidor','lardan_consultora','fiscal')),
  name text NOT NULL,
  basis text,
  percent numeric(9,6),
  precision_digits integer NOT NULL DEFAULT 2,
  rounding text NOT NULL DEFAULT 'half_up' CHECK (rounding IN ('half_up','half_even','down','up')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('rascunho','pendente','vigente','suspensa','encerrada')),
  pending_reason text,
  fundamento text,
  valid_from date,
  valid_to date,
  responsible_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pricing_policies TO authenticated;
GRANT ALL ON public.pricing_policies TO service_role;
ALTER TABLE public.pricing_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_policies_read" ON public.pricing_policies FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view') OR public.has_capability(auth.uid(),'catalog.cost.view'));
CREATE POLICY "pricing_policies_write" ON public.pricing_policies FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

-- uma regra só vigora com percentual e fundamento explícitos
CREATE OR REPLACE FUNCTION public.pricing_policy_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.status = 'vigente' THEN
    IF NEW.percent IS NULL OR nullif(trim(coalesce(NEW.fundamento,'')),'') IS NULL
       OR NEW.valid_from IS NULL OR NEW.responsible_user_id IS NULL THEN
      RAISE EXCEPTION 'Uma regra só entra em vigor com percentual, fundamento, início de vigência e responsável.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS pricing_policy_guard ON public.pricing_policies;
CREATE TRIGGER pricing_policy_guard BEFORE INSERT OR UPDATE ON public.pricing_policies
  FOR EACH ROW EXECUTE FUNCTION public.pricing_policy_guard();

INSERT INTO public.pricing_policies (scope, name, basis, percent, status, pending_reason, fundamento)
SELECT 'fiscal', 'Valor fiscal da remessa em consignação',
       'Proporção do preço de varejo informada verbalmente', NULL, 'pendente',
       'O Daniel informou notas em torno de um terço do preço de varejo. A base comercial e fiscal desse percentual não foi esclarecida. 33%, 33,33% e um terço não são equivalentes e nenhum deles foi adotado.',
       NULL
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_policies WHERE scope='fiscal');

CREATE TABLE IF NOT EXISTS public.variant_price_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('custo','consumidor','lardan_consultora','fiscal')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  policy_id uuid REFERENCES public.pricing_policies(id),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','importado','calculado')),
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS variant_price_points_variant_idx
  ON public.variant_price_points (variant_id, kind, valid_from DESC);
GRANT SELECT, INSERT, UPDATE ON public.variant_price_points TO authenticated;
GRANT ALL ON public.variant_price_points TO service_role;
ALTER TABLE public.variant_price_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "price_points_read" ON public.variant_price_points FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'catalog.cost.view') OR public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "price_points_write" ON public.variant_price_points FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

-- ---------------- fiscal ----------------
CREATE TABLE IF NOT EXISTS public.fiscal_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  emission_active boolean NOT NULL DEFAULT false,
  provider text,
  emitter_entity_id uuid REFERENCES public.business_entities(id),
  environment text NOT NULL DEFAULT 'nenhum' CHECK (environment IN ('nenhum','homologacao','producao')),
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.fiscal_settings TO authenticated;
GRANT ALL ON public.fiscal_settings TO service_role;
ALTER TABLE public.fiscal_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fiscal_settings_read" ON public.fiscal_settings FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "fiscal_settings_write" ON public.fiscal_settings FOR UPDATE TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));
INSERT INTO public.fiscal_settings (id, note)
SELECT true, 'Emissão fiscal desligada. Nenhum provedor, emissor, CFOP ou tributação definidos.'
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_settings);

CREATE TABLE IF NOT EXISTS public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid REFERENCES public.kit_cycles(id),
  movement_id uuid REFERENCES public.kit_movements(id),
  order_id uuid REFERENCES public.sales_orders(id),
  kind text NOT NULL CHECK (kind IN ('remessa','acrescimo','venda','retorno','devolucao_simbolica')),
  status text NOT NULL DEFAULT 'preparacao'
    CHECK (status IN ('preparacao','enviado','autorizado','rejeitado','cancelado')),
  moves_physical_stock boolean NOT NULL DEFAULT true,
  emitter_entity_id uuid REFERENCES public.business_entities(id),
  recipient_party_id uuid REFERENCES public.parties(id),
  custodian_party_id uuid REFERENCES public.parties(id),
  debtor_party_id uuid REFERENCES public.parties(id),
  references_document_id uuid REFERENCES public.fiscal_documents(id),
  series text, number text, access_key text, protocol text,
  xml_path text, pdf_path text,
  total_cents bigint NOT NULL DEFAULT 0,
  issued_at timestamptz, authorized_at timestamptz, rejected_reason text,
  provider text, provider_request_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_key_uidx
  ON public.fiscal_documents (access_key) WHERE access_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_request_uidx
  ON public.fiscal_documents (provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE ON public.fiscal_documents TO authenticated;
GRANT ALL ON public.fiscal_documents TO service_role;
ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fiscal_documents_read" ON public.fiscal_documents FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "fiscal_documents_write" ON public.fiscal_documents FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

CREATE TABLE IF NOT EXISTS public.fiscal_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  movement_item_id uuid REFERENCES public.kit_movement_items(id),
  composition_item_id uuid REFERENCES public.kit_composition_items(id),
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_value_cents bigint,
  cfop text, tax_regime text, natureza text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.fiscal_document_items TO authenticated;
GRANT ALL ON public.fiscal_document_items TO service_role;
ALTER TABLE public.fiscal_document_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fiscal_document_items_read" ON public.fiscal_document_items FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "fiscal_document_items_write" ON public.fiscal_document_items FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

CREATE OR REPLACE FUNCTION public.fiscal_document_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE ativo boolean;
BEGIN
  SELECT emission_active INTO ativo FROM public.fiscal_settings WHERE id;
  IF NEW.status <> 'preparacao' AND coalesce(ativo,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'A emissão fiscal não está ativa. Nenhum documento pode sair da preparação.';
  END IF;
  IF NEW.kind = 'devolucao_simbolica' THEN NEW.moves_physical_stock := false; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'autorizado'
     AND NEW.status NOT IN ('autorizado','cancelado') THEN
    RAISE EXCEPTION 'Documento autorizado não volta atrás; o caminho é o cancelamento.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS fiscal_document_guard ON public.fiscal_documents;
CREATE TRIGGER fiscal_document_guard BEFORE INSERT OR UPDATE ON public.fiscal_documents
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_document_guard();

CREATE TABLE IF NOT EXISTS public.fiscal_pendencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo text NOT NULL,
  descricao text NOT NULL,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resolvida')),
  responsavel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.fiscal_pendencias TO authenticated;
GRANT ALL ON public.fiscal_pendencias TO service_role;
ALTER TABLE public.fiscal_pendencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fiscal_pendencias_read" ON public.fiscal_pendencias FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "fiscal_pendencias_write" ON public.fiscal_pendencias FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

INSERT INTO public.fiscal_pendencias (escopo, descricao)
SELECT v.e, v.d FROM (VALUES
  ('emissor','Qual pessoa jurídica emite os documentos e em qual UF.'),
  ('regime','Regime tributário do emissor e enquadramento das operações.'),
  ('destinatario','CPF/CNPJ e inscrição estadual de consultoras e representantes.'),
  ('operacao','Natureza e CFOP de remessa, acréscimo, venda, retorno e devolução simbólica.'),
  ('valor','Base comercial e fiscal da proporção informada como "um terço" do varejo.'),
  ('provedor','API de emissão não escolhida. Nada pode ser simulado como autorizado.')
) v(e,d)
WHERE NOT EXISTS (SELECT 1 FROM public.fiscal_pendencias p WHERE p.escopo = v.e);

-- ---------------- Asaas (preparado, desligado) ----------------
CREATE TABLE IF NOT EXISTS public.asaas_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','producao')),
  is_active boolean NOT NULL DEFAULT false,
  cutover_date date,
  opening_balance_handled boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.asaas_accounts TO authenticated;
GRANT ALL ON public.asaas_accounts TO service_role;
ALTER TABLE public.asaas_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asaas_accounts_read" ON public.asaas_accounts FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));
CREATE POLICY "asaas_accounts_write" ON public.asaas_accounts FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.settings.manage'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.settings.manage'));

CREATE TABLE IF NOT EXISTS public.asaas_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text,
  doc text,
  email text,
  party_id uuid REFERENCES public.parties(id),
  match_status text NOT NULL DEFAULT 'pendente'
    CHECK (match_status IN ('pendente','vinculado','ambiguo','ignorado')),
  match_note text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
GRANT SELECT, INSERT, UPDATE ON public.asaas_customers TO authenticated;
GRANT ALL ON public.asaas_customers TO service_role;
ALTER TABLE public.asaas_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asaas_customers_read" ON public.asaas_customers FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));
CREATE POLICY "asaas_customers_write" ON public.asaas_customers FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.import.approve'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.import.approve'));

CREATE TABLE IF NOT EXISTS public.asaas_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  customer_external_id text,
  installment_external_id text,
  installment_number integer,
  installment_count integer,
  value_cents bigint NOT NULL DEFAULT 0,
  net_value_cents bigint,
  fee_cents bigint,
  received_cents bigint,
  due_date date,
  payment_date date,
  credit_date date,
  billing_type text,
  external_status text,
  title_id uuid REFERENCES public.financial_titles(id),
  installment_id uuid REFERENCES public.financial_installments(id),
  reconcile_status text NOT NULL DEFAULT 'pendente'
    CHECK (reconcile_status IN ('pendente','vinculado','duplicidade_suspeita','ignorado')),
  reconcile_note text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
GRANT SELECT, INSERT, UPDATE ON public.asaas_charges TO authenticated;
GRANT ALL ON public.asaas_charges TO service_role;
ALTER TABLE public.asaas_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asaas_charges_read" ON public.asaas_charges FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));
CREATE POLICY "asaas_charges_write" ON public.asaas_charges FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.import.approve'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.import.approve'));

CREATE TABLE IF NOT EXISTS public.asaas_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  event text NOT NULL,
  charge_external_id text,
  event_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  status text NOT NULL DEFAULT 'na_fila'
    CHECK (status IN ('na_fila','processado','ignorado','erro')),
  UNIQUE (external_id)
);
GRANT SELECT ON public.asaas_events TO authenticated;
GRANT ALL ON public.asaas_events TO service_role;
ALTER TABLE public.asaas_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asaas_events_read" ON public.asaas_events FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.audit.view'));

CREATE TABLE IF NOT EXISTS public.asaas_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'previa' CHECK (mode IN ('previa','efetivar')),
  status text NOT NULL DEFAULT 'preparada'
    CHECK (status IN ('preparada','em_andamento','pausada','concluida','erro')),
  cursor text,
  page integer NOT NULL DEFAULT 0,
  imported integer NOT NULL DEFAULT 0,
  duplicated integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  started_at timestamptz, finished_at timestamptz,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.asaas_import_runs TO authenticated;
GRANT ALL ON public.asaas_import_runs TO service_role;
ALTER TABLE public.asaas_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asaas_runs_read" ON public.asaas_import_runs FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));
CREATE POLICY "asaas_runs_write" ON public.asaas_import_runs FOR ALL TO authenticated
  USING (public.has_capability(auth.uid(),'finance.import.run'))
  WITH CHECK (public.has_capability(auth.uid(),'finance.import.run'));

-- nenhuma cobrança externa vira título automaticamente sem vínculo comprovado
CREATE OR REPLACE FUNCTION public.asaas_charge_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.reconcile_status = 'vinculado' AND NEW.title_id IS NULL AND NEW.installment_id IS NULL THEN
    RAISE EXCEPTION 'Só é possível marcar como vinculada uma cobrança ligada a um título ou parcela.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_charge_guard ON public.asaas_charges;
CREATE TRIGGER asaas_charge_guard BEFORE INSERT OR UPDATE ON public.asaas_charges
  FOR EACH ROW EXECUTE FUNCTION public.asaas_charge_guard();
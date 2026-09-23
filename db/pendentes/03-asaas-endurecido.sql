-- ============================================================
-- Asaas: endurecimento das estruturas. Nada é conectado aqui.
-- Sem credencial, sem chamada externa, produção impossível de ativar.
-- ============================================================

-- ---------------- contas ----------------
ALTER TABLE public.asaas_accounts
  ADD COLUMN IF NOT EXISTS owner_entity_id uuid REFERENCES public.business_entities(id),
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'preparada',
  ADD COLUMN IF NOT EXISTS opening_balance_strategy text NOT NULL DEFAULT 'nao_definida',
  ADD COLUMN IF NOT EXISTS secret_ref text,
  ADD COLUMN IF NOT EXISTS webhook_secret_ref text,
  ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_cursor text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_accounts_state_ck') THEN
    ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_state_ck
      CHECK (state IN ('preparada','simulada','sandbox_conectada','producao_conectada','suspensa'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_accounts_opening_ck') THEN
    ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_opening_ck
      CHECK (opening_balance_strategy IN ('nao_definida','ignorar_anteriores','saldo_inicial_unico','importar_historico'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_accounts_secret_ck') THEN
    -- referência ao segredo, nunca o segredo: só nome de variável de ambiente
    ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_secret_ck
      CHECK (secret_ref IS NULL OR secret_ref ~ '^[A-Z][A-Z0-9_]{3,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_accounts_webhook_secret_ck') THEN
    ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_webhook_secret_ck
      CHECK (webhook_secret_ref IS NULL OR webhook_secret_ref ~ '^[A-Z][A-Z0-9_]{3,64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS asaas_accounts_externo_uidx
  ON public.asaas_accounts (environment, external_account_id)
  WHERE external_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.asaas_account_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.environment = 'producao' AND (NEW.is_active OR NEW.state = 'producao_conectada') THEN
    RAISE EXCEPTION 'Conta de produção não pode ser ativada nesta preparação.';
  END IF;
  IF NEW.state = 'sandbox_conectada' AND NEW.environment <> 'sandbox' THEN
    RAISE EXCEPTION 'Estado incompatível com o ambiente da conta.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.environment <> OLD.environment THEN
    RAISE EXCEPTION 'O ambiente da conta não muda depois de criada; crie outra conta.';
  END IF;
  IF NEW.secret_ref IS NOT NULL AND (NEW.secret_ref ILIKE '%$aact%' OR length(NEW.secret_ref) > 64) THEN
    RAISE EXCEPTION 'Aqui vai o NOME da variável de ambiente, nunca o segredo.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_account_guard ON public.asaas_accounts;
CREATE TRIGGER asaas_account_guard BEFORE INSERT OR UPDATE ON public.asaas_accounts
  FOR EACH ROW EXECUTE FUNCTION public.asaas_account_guard();

/** Identidade canônica da origem do título: evita colisão entre contas. */
CREATE OR REPLACE FUNCTION public.asaas_origin_key(_account uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $fn$
  SELECT 'asaas:' || _account::text
$fn$;

-- ---------------- conta imutável nos registros derivados ----------------
CREATE OR REPLACE FUNCTION public.asaas_account_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Registro do Asaas não muda de conta depois de criado.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_customers_account_immutable ON public.asaas_customers;
CREATE TRIGGER asaas_customers_account_immutable BEFORE UPDATE ON public.asaas_customers
  FOR EACH ROW EXECUTE FUNCTION public.asaas_account_immutable();
DROP TRIGGER IF EXISTS asaas_charges_account_immutable ON public.asaas_charges;
CREATE TRIGGER asaas_charges_account_immutable BEFORE UPDATE ON public.asaas_charges
  FOR EACH ROW EXECUTE FUNCTION public.asaas_account_immutable();
DROP TRIGGER IF EXISTS asaas_runs_account_immutable ON public.asaas_import_runs;
CREATE TRIGGER asaas_runs_account_immutable BEFORE UPDATE ON public.asaas_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.asaas_account_immutable();

-- ---------------- eventos: unicidade por conta + ID ----------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.asaas_events WHERE account_id IS NULL) THEN
    RAISE EXCEPTION 'Existem eventos sem conta; trate-os antes de endurecer a regra.';
  END IF;
END $$;

-- restrição obrigatória: se falhar, a preparação falha (sem silenciar)
ALTER TABLE public.asaas_events ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE public.asaas_events DROP CONSTRAINT IF EXISTS asaas_events_external_id_key;
DROP INDEX IF EXISTS public.asaas_events_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_events_conta_externo_uidx
  ON public.asaas_events (account_id, external_id);

ALTER TABLE public.asaas_events
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS sequence_hint timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_events_classification_ck') THEN
    ALTER TABLE public.asaas_events ADD CONSTRAINT asaas_events_classification_ck
      CHECK (classification IN ('pendente','conhecido','desconhecido','revisao'));
  END IF;
END $$;

-- catálogo dos eventos tratados (preparação; webhook inativo)
CREATE TABLE IF NOT EXISTS public.asaas_event_types (
  event text PRIMARY KEY,
  familia text NOT NULL,
  efeito_preparatorio text NOT NULL,
  cria_baixa boolean NOT NULL DEFAULT false,
  nota text
);
GRANT SELECT ON public.asaas_event_types TO authenticated;
GRANT ALL ON public.asaas_event_types TO service_role;
ALTER TABLE public.asaas_event_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_event_types_read ON public.asaas_event_types;
CREATE POLICY asaas_event_types_read ON public.asaas_event_types FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.view'));

INSERT INTO public.asaas_event_types (event, familia, efeito_preparatorio, cria_baixa, nota) VALUES
 ('PAYMENT_CREATED','cobranca','espelha a cobrança',false,'Nenhuma obrigação interna nasce daqui.'),
 ('PAYMENT_UPDATED','cobranca','atualiza o espelho',false,null),
 ('PAYMENT_CONFIRMED','cobranca','atualiza a situação da cobrança',false,'Confirmação não é recebimento.'),
 ('PAYMENT_RECEIVED','recebimento','marca dinheiro disponibilizado',false,'A baixa só nasce de regra financeira aprovada.'),
 ('PAYMENT_OVERDUE','cobranca','marca atraso',false,null),
 ('PAYMENT_DELETED','cobranca','marca excluída no provedor',false,'Não apaga liquidação nem razão.'),
 ('PAYMENT_RESTORED','cobranca','marca restaurada',false,null),
 ('PAYMENT_REFUNDED','estorno','prepara estorno pelo motor existente',false,null),
 ('PAYMENT_PARTIALLY_REFUNDED','estorno','prepara estorno parcial',false,null),
 ('PAYMENT_REFUND_IN_PROGRESS','estorno','estorno em andamento',false,null),
 ('PAYMENT_REFUND_DENIED','estorno','estorno recusado',false,null),
 ('PAYMENT_RECEIVED_IN_CASH_UNDONE','recebimento','desfaz recebimento em dinheiro',false,'Compensação, nunca exclusão.'),
 ('PAYMENT_CHARGEBACK_REQUESTED','chargeback','abre disputa',false,null),
 ('PAYMENT_CHARGEBACK_DISPUTE','chargeback','disputa em andamento',false,null),
 ('PAYMENT_AWAITING_CHARGEBACK_REVERSAL','chargeback','aguardando reversão',false,null),
 ('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','cobranca','captura recusada',false,null),
 ('PAYMENT_ANTICIPATED','cobranca','antecipação registrada',false,'Antecipação não é recebimento do cliente.')
ON CONFLICT (event) DO NOTHING;

-- ---------------- integridade das cobranças ----------------
ALTER TABLE public.asaas_charges
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES public.parties(id),
  ADD COLUMN IF NOT EXISTS confirmed_date date,
  ADD COLUMN IF NOT EXISTS interest_cents bigint,
  ADD COLUMN IF NOT EXISTS fine_cents bigint,
  ADD COLUMN IF NOT EXISTS discount_cents bigint,
  ADD COLUMN IF NOT EXISTS refunded_cents bigint,
  ADD COLUMN IF NOT EXISTS linked_by uuid,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_charges_valores_ck') THEN
    ALTER TABLE public.asaas_charges ADD CONSTRAINT asaas_charges_valores_ck CHECK (
      value_cents >= 0
      AND coalesce(received_cents,0) >= 0
      AND coalesce(net_value_cents,0) >= 0
      AND coalesce(fee_cents,0) >= 0
      AND coalesce(refunded_cents,0) >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_charges_datas_ck') THEN
    ALTER TABLE public.asaas_charges ADD CONSTRAINT asaas_charges_datas_ck CHECK (
      due_date IS NULL OR due_date >= date '2000-01-01');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.asaas_charge_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.asaas_charges(id) ON DELETE CASCADE,
  campo text NOT NULL,
  de text,
  para text,
  origem text NOT NULL DEFAULT 'importacao',
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_charge_changes TO authenticated;
GRANT ALL ON public.asaas_charge_changes TO service_role;
ALTER TABLE public.asaas_charge_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_charge_changes_read ON public.asaas_charge_changes;
CREATE POLICY asaas_charge_changes_read ON public.asaas_charge_changes FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.audit.view'));

-- Semântica dos valores (documentada em docs/lardan/ASAAS-ADAPTADOR.md):
--   value_cents      = valor cobrado no documento
--   received_cents   = valor efetivamente pago pelo cliente no evento de recebimento
--   fee_cents        = tarifa do provedor sobre AQUELE recebimento
--   net_value_cents  = líquido creditado na conta do provedor por AQUELE recebimento
-- Só reconciliamos componentes do MESMO evento e só quando os três são conhecidos.
-- Desconhecido continua NULL: nunca vira zero.
CREATE OR REPLACE FUNCTION public.asaas_charge_integridade()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE t record; conta record; ent uuid;
        oficial boolean := coalesce(current_setting('lardann.asaas_link', true), 'off') = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.external_id IS DISTINCT FROM OLD.external_id THEN
    RAISE EXCEPTION 'O identificador externo da cobrança não muda.';
  END IF;

  -- campos controlados: vínculo, estado externo e resultado externo só pelas rotinas
  IF TG_OP = 'UPDATE' AND NOT oficial THEN
    IF NEW.title_id IS DISTINCT FROM OLD.title_id
       OR NEW.installment_id IS DISTINCT FROM OLD.installment_id THEN
      RAISE EXCEPTION 'Vínculo de cobrança só muda pela rotina oficial.';
    END IF;
    IF NEW.reconcile_status IS DISTINCT FROM OLD.reconcile_status THEN
      RAISE EXCEPTION 'Situação de conciliação só muda pela rotina oficial.';
    END IF;
    IF NEW.external_status IS DISTINCT FROM OLD.external_status
       OR NEW.received_cents IS DISTINCT FROM OLD.received_cents
       OR NEW.net_value_cents IS DISTINCT FROM OLD.net_value_cents
       OR NEW.fee_cents IS DISTINCT FROM OLD.fee_cents
       OR NEW.refunded_cents IS DISTINCT FROM OLD.refunded_cents
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.credit_date IS DISTINCT FROM OLD.credit_date THEN
      RAISE EXCEPTION 'Resultado externo da cobrança só entra pelas rotinas de importação e evento.';
    END IF;
    IF NEW.linked_by IS DISTINCT FROM OLD.linked_by OR NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
      RAISE EXCEPTION 'Autor e horário do vínculo são definidos pelo servidor.';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NOT oficial
     AND (NEW.title_id IS NOT NULL OR NEW.installment_id IS NOT NULL
          OR NEW.reconcile_status = 'vinculado' OR NEW.linked_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Cobrança nasce sem vínculo; vincular é rotina oficial.';
  END IF;

  IF coalesce(NEW.received_cents,0) > 0
     AND NEW.net_value_cents IS NOT NULL AND NEW.fee_cents IS NOT NULL
     AND NEW.net_value_cents + NEW.fee_cents <> NEW.received_cents THEN
    RAISE EXCEPTION 'Componentes do mesmo recebimento não fecham (recebido = líquido + tarifa).';
  END IF;

  IF NEW.title_id IS NOT NULL THEN
    SELECT * INTO t FROM public.financial_titles WHERE id = NEW.title_id;
    IF t.id IS NULL THEN RAISE EXCEPTION 'Título inexistente.'; END IF;
    IF t.direction <> 'receivable' THEN
      RAISE EXCEPTION 'Cobrança do Asaas só se liga a título a receber.';
    END IF;
    IF NEW.installment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.financial_installments i
       WHERE i.id = NEW.installment_id AND i.title_id = NEW.title_id) THEN
      RAISE EXCEPTION 'A parcela informada pertence a outro título.';
    END IF;
    IF NEW.party_id IS NULL THEN
      RAISE EXCEPTION 'Cobrança vinculada exige pessoa identificada; pendência cadastral não passa em branco.';
    END IF;
    IF t.party_id IS NOT NULL AND NEW.party_id <> coalesce(t.pagador_party_id, t.party_id) THEN
      RAISE EXCEPTION 'A pessoa da cobrança não é o devedor do título.';
    END IF;
  ELSIF NEW.installment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Parcela informada sem título.';
  END IF;

  SELECT * INTO conta FROM public.asaas_accounts WHERE id = NEW.account_id;
  IF conta.environment = 'producao' AND conta.is_active IS NOT TRUE THEN
    IF NEW.reconcile_status = 'vinculado' THEN
      RAISE EXCEPTION 'Conta de produção inativa: nada pode ser vinculado.';
    END IF;
  END IF;

  -- empresa proprietária da conta x empresa do título
  IF NEW.title_id IS NOT NULL THEN
    ent := conta.owner_entity_id;
    IF ent IS NULL THEN
      RAISE EXCEPTION 'Conta Asaas sem empresa proprietária: vínculo bloqueado.';
    END IF;
    IF t.business_entity_id IS NULL THEN
      RAISE EXCEPTION 'Título sem empresa: pendência cadastral, vínculo bloqueado.';
    END IF;
    IF t.business_entity_id <> ent THEN
      RAISE EXCEPTION 'A conta Asaas pertence a outra empresa que não a do título.';
    END IF;
  END IF;

  -- cliente externo coerente com a pessoa
  IF NEW.party_id IS NOT NULL AND NEW.customer_external_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.asaas_customers cu
     WHERE cu.account_id = NEW.account_id AND cu.external_id = NEW.customer_external_id
       AND cu.party_id IS NOT NULL AND cu.party_id <> NEW.party_id) THEN
    RAISE EXCEPTION 'O cliente externo desta cobrança está vinculado a outra pessoa.';
  END IF;

  IF NEW.reconcile_status = 'vinculado' AND NOT oficial THEN
    RAISE EXCEPTION 'Vínculo de cobrança só pela rotina oficial.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.external_status IS DISTINCT FROM OLD.external_status THEN
      INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, actor_user_id)
      VALUES (NEW.id, 'external_status', OLD.external_status, NEW.external_status, auth.uid());
    END IF;
    IF NEW.received_cents IS DISTINCT FROM OLD.received_cents THEN
      INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, actor_user_id)
      VALUES (NEW.id, 'received_cents', OLD.received_cents::text, NEW.received_cents::text, auth.uid());
    END IF;
  END IF;

  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_charge_integridade ON public.asaas_charges;
CREATE TRIGGER asaas_charge_integridade BEFORE INSERT OR UPDATE ON public.asaas_charges
  FOR EACH ROW EXECUTE FUNCTION public.asaas_charge_integridade();

/**
 * Vínculo oficial cobrança → título/parcela. Não cria título e não dá baixa.
 * Repetição só é repetição quando o vínculo COMPLETO é igual (título e parcela).
 * Mesmo título com parcela diferente é conflito: exige alteração explícita.
 */
CREATE OR REPLACE FUNCTION public.asaas_charge_vincular(
  _charge uuid, _title uuid, _installment uuid DEFAULT NULL, _motivo text DEFAULT NULL,
  _alterar boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record; processado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF NOT public.has_capability(auth.uid(),'finance.import.approve') THEN
    RAISE EXCEPTION 'Sem permissão para vincular cobranças.';
  END IF;
  IF _title IS NULL THEN RAISE EXCEPTION 'Informe o título.'; END IF;
  SELECT * INTO c FROM public.asaas_charges WHERE id = _charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;

  IF c.title_id IS NOT NULL THEN
    IF c.title_id = _title AND c.installment_id IS NOT DISTINCT FROM _installment THEN
      RETURN jsonb_build_object('id', c.id, 'repetida', true,
        'title_id', c.title_id, 'installment_id', c.installment_id);
    END IF;
    -- já houve processamento financeiro? então nem alteração explícita desvincula
    SELECT EXISTS (
      SELECT 1 FROM public.financial_allocations a
        JOIN public.financial_installments i ON i.id = a.installment_id
       WHERE i.title_id = c.title_id
         AND (c.installment_id IS NULL OR a.installment_id = c.installment_id)
    ) INTO processado;
    IF processado THEN
      RAISE EXCEPTION 'Já houve processamento financeiro neste vínculo: trate por conciliação, não por troca.';
    END IF;
    IF NOT _alterar THEN
      RAISE EXCEPTION 'Conflito de vínculo: esta cobrança já aponta para outro título ou parcela.';
    END IF;
    IF coalesce(btrim(_motivo),'') = '' THEN
      RAISE EXCEPTION 'Alterar vínculo exige motivo.';
    END IF;
  END IF;

  PERFORM set_config('lardann.asaas_link','on', true);
  UPDATE public.asaas_charges
     SET title_id = _title, installment_id = _installment, reconcile_status = 'vinculado',
         reconcile_note = _motivo, linked_by = auth.uid(), linked_at = now()
   WHERE id = _charge;
  PERFORM set_config('lardann.asaas_link','off', true);

  INSERT INTO public.asaas_charge_changes (charge_id, campo, de, para, origem, actor_user_id)
  VALUES (_charge, 'title_id', c.title_id::text, _title::text,
          CASE WHEN c.title_id IS NULL THEN 'vinculo_manual' ELSE 'vinculo_alterado' END, auth.uid()),
         (_charge, 'installment_id', c.installment_id::text, _installment::text,
          CASE WHEN c.title_id IS NULL THEN 'vinculo_manual' ELSE 'vinculo_alterado' END, auth.uid());

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.charge.vincular', 'asaas_charges', _charge,
          jsonb_build_object('title_id', _title, 'installment_id', _installment,
                             'alterado', c.title_id IS NOT NULL, 'motivo', _motivo));

  RETURN jsonb_build_object('id', _charge, 'repetida', false, 'title_id', _title,
    'installment_id', _installment, 'alterado', c.title_id IS NOT NULL,
    'aviso', 'Vínculo registrado. Nenhuma baixa financeira foi criada.');
END $fn$;
DROP FUNCTION IF EXISTS public.asaas_charge_vincular(uuid,uuid,uuid,text);
REVOKE ALL ON FUNCTION public.asaas_charge_vincular(uuid,uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_charge_vincular(uuid,uuid,uuid,text,boolean) TO authenticated;

-- ---------------- dados pessoais: acesso mínimo ----------------
-- quem apenas vê recebíveis não enxerga documento, e-mail nem payload bruto
REVOKE SELECT ON public.asaas_customers FROM authenticated;
GRANT SELECT (id, account_id, external_id, name, party_id, match_status, match_note,
              created_at, updated_at) ON public.asaas_customers TO authenticated;
REVOKE SELECT ON public.asaas_charges FROM authenticated;
GRANT SELECT (id, account_id, external_id, customer_external_id, installment_external_id,
              installment_number, installment_count, value_cents, net_value_cents, fee_cents,
              received_cents, refunded_cents, interest_cents, fine_cents, discount_cents,
              due_date, payment_date, credit_date, confirmed_date, billing_type, external_status,
              title_id, installment_id, party_id, reconcile_status, reconcile_note,
              linked_by, linked_at, imported_at, updated_at) ON public.asaas_charges TO authenticated;
REVOKE SELECT ON public.asaas_events FROM authenticated;
GRANT SELECT (id, account_id, external_id, event, charge_external_id, event_at, received_at,
              processed_at, attempts, last_error, status, classification, next_attempt_at)
  ON public.asaas_events TO authenticated;

/** Leitura auditada de dado sensível: exige auditoria financeira e fica registrada. */
CREATE OR REPLACE FUNCTION public.asaas_customer_sensivel(_customer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE c record;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.audit.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver dados pessoais completos.';
  END IF;
  SELECT * INTO c FROM public.asaas_customers WHERE id = _customer;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cliente inexistente.'; END IF;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.customer.sensivel', 'asaas_customers', c.id, '{}'::jsonb);
  RETURN jsonb_build_object('doc', c.doc, 'email', c.email);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_customer_sensivel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_customer_sensivel(uuid) TO authenticated;

-- payload bruto nunca guarda credencial
CREATE OR REPLACE FUNCTION public.asaas_raw_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE texto text := coalesce(NEW.raw::text, '');
BEGIN
  IF texto ILIKE '%access_token%' OR texto ILIKE '%$aact_%' OR texto ILIKE '%apiKey%' THEN
    RAISE EXCEPTION 'Payload com aparência de credencial não é armazenado.';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_raw_guard_customers ON public.asaas_customers;
CREATE TRIGGER asaas_raw_guard_customers BEFORE INSERT OR UPDATE ON public.asaas_customers
  FOR EACH ROW EXECUTE FUNCTION public.asaas_raw_guard();
DROP TRIGGER IF EXISTS asaas_raw_guard_charges ON public.asaas_charges;
CREATE TRIGGER asaas_raw_guard_charges BEFORE INSERT OR UPDATE ON public.asaas_charges
  FOR EACH ROW EXECUTE FUNCTION public.asaas_raw_guard();

-- ---------------- importação: modos separados ----------------
ALTER TABLE public.asaas_import_runs
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'historica',
  ADD COLUMN IF NOT EXISTS window_start date,
  ADD COLUMN IF NOT EXISTS window_end date,
  ADD COLUMN IF NOT EXISTS page_size integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS offset_atual integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_more boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS simulado boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_import_runs_kind_ck') THEN
    ALTER TABLE public.asaas_import_runs ADD CONSTRAINT asaas_import_runs_kind_ck
      CHECK (kind IN ('historica','sincronizacao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asaas_import_runs_page_ck') THEN
    ALTER TABLE public.asaas_import_runs ADD CONSTRAINT asaas_import_runs_page_ck
      CHECK (page_size > 0 AND page_size <= 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.asaas_import_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.asaas_import_runs(id) ON DELETE CASCADE,
  charge_external_id text,
  customer_external_id text,
  tipo text NOT NULL CHECK (tipo IN (
    'criaria_titulo','vinculo_sugerido','duplicidade_suspeita','cliente_ambiguo',
    'cobranca_sem_titulo','titulo_sem_cobranca','cobranca_incompativel','erro')),
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolvido boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_import_findings TO authenticated;
GRANT ALL ON public.asaas_import_findings TO service_role;
ALTER TABLE public.asaas_import_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_import_findings_read ON public.asaas_import_findings;
CREATE POLICY asaas_import_findings_read ON public.asaas_import_findings FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));

-- efetivar exige aprovação explícita
CREATE OR REPLACE FUNCTION public.asaas_import_run_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.mode = 'efetivar' AND NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Efetivar importação exige aprovação registrada.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_import_run_guard ON public.asaas_import_runs;
CREATE TRIGGER asaas_import_run_guard BEFORE INSERT OR UPDATE ON public.asaas_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.asaas_import_run_guard();

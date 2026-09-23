-- ============================================================
-- Contas a receber do Asaas: espelho importado, intenção de cobrança,
-- link de fatura e recebimento de eventos.
--
-- Nada aqui liga integração nenhuma: não há URL, credencial, chamada externa
-- nem emissão fiscal. O transporte vive na aplicação e, nesta rodada, é o
-- simulador. O banco só guarda intenção, resultado e conciliação.
--
-- Reaproveita o motor financeiro existente (financial_titles,
-- financial_installments, financial_settlements, financial_allocations).
-- Nenhum financeiro paralelo é criado.
-- ============================================================

-- ---------------- matriz de efeitos dos eventos ----------------
ALTER TABLE public.asaas_event_types
  ADD COLUMN IF NOT EXISTS estado_externo text,
  ADD COLUMN IF NOT EXISTS efeito_recebivel text NOT NULL DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS efeito_caixa text NOT NULL DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS ajuste_ou_tarifa text NOT NULL DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS estorno text NOT NULL DEFAULT 'nenhum',
  ADD COLUMN IF NOT EXISTS revisao_manual boolean NOT NULL DEFAULT false;

UPDATE public.asaas_event_types SET
  estado_externo = x.estado, efeito_recebivel = x.receb, efeito_caixa = x.caixa,
  ajuste_ou_tarifa = x.ajuste, estorno = x.estorno, revisao_manual = x.revisao
FROM (VALUES
 ('PAYMENT_CREATED','PENDING','espelha','nenhum','nenhum','nenhum',false),
 ('PAYMENT_UPDATED','PENDING','espelha','nenhum','nenhum','nenhum',false),
 ('PAYMENT_CONFIRMED','CONFIRMED','confirmado_sem_baixa','nenhum','nenhum','nenhum',false),
 ('PAYMENT_RECEIVED','RECEIVED','recebimento_registrado','credita_conta_asaas','tarifa_quando_informada','nenhum',false),
 ('PAYMENT_RECEIVED_IN_CASH','RECEIVED_IN_CASH','recebimento_registrado','fora_do_asaas','nenhum','nenhum',true),
 ('PAYMENT_OVERDUE','OVERDUE','atraso','nenhum','nenhum','nenhum',false),
 ('PAYMENT_DELETED','DELETED','cobranca_invalidada','nenhum','nenhum','nenhum',true),
 ('PAYMENT_RESTORED','PENDING','espelha','nenhum','nenhum','nenhum',false),
 ('PAYMENT_REFUNDED','REFUNDED','estorno_total','debita_conta_asaas','nenhum','total',true),
 ('PAYMENT_PARTIALLY_REFUNDED','PARTIALLY_REFUNDED','estorno_parcial','debita_conta_asaas','nenhum','parcial',true),
 ('PAYMENT_REFUND_IN_PROGRESS','REFUND_IN_PROGRESS','estorno_em_andamento','nenhum','nenhum','nenhum',true),
 ('PAYMENT_REFUND_DENIED','RECEIVED','espelha','nenhum','nenhum','nenhum',false),
 ('PAYMENT_RECEIVED_IN_CASH_UNDONE','PENDING','recebimento_desfeito','nenhum','nenhum','compensacao',true),
 ('PAYMENT_CHARGEBACK_REQUESTED','CHARGEBACK_REQUESTED','disputa','nenhum','nenhum','nenhum',true),
 ('PAYMENT_CHARGEBACK_DISPUTE','CHARGEBACK_DISPUTE','disputa','nenhum','nenhum','nenhum',true),
 ('PAYMENT_AWAITING_CHARGEBACK_REVERSAL','AWAITING_CHARGEBACK_REVERSAL','disputa','nenhum','nenhum','nenhum',true),
 ('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','PENDING','recusada','nenhum','nenhum','nenhum',false),
 ('PAYMENT_ANTICIPATED','RECEIVED','antecipacao','nenhum','nenhum','nenhum',true)
) AS x(event, estado, receb, caixa, ajuste, estorno, revisao)
WHERE x.event = public.asaas_event_types.event;

INSERT INTO public.asaas_event_types
  (event, familia, efeito_preparatorio, cria_baixa, nota, estado_externo,
   efeito_recebivel, efeito_caixa, ajuste_ou_tarifa, estorno, revisao_manual)
VALUES ('PAYMENT_RECEIVED_IN_CASH','recebimento','recebimento fora do Asaas',false,
        'Dinheiro não entra na conta Asaas: a conta financeira é decisão humana.',
        'RECEIVED_IN_CASH','recebimento_registrado','fora_do_asaas','nenhum','nenhum',true)
ON CONFLICT (event) DO NOTHING;

-- ---------------- prévia da importação ----------------
CREATE TABLE IF NOT EXISTS public.asaas_import_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.asaas_import_runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cobranca','cliente')),
  external_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  classificacao text NOT NULL DEFAULT 'pendente'
    CHECK (classificacao IN ('pendente','novo','ja_existe','vinculo_sugerido',
                             'duplicidade_suspeita','cliente_ambiguo','historico',
                             'saldo_inicial','incompativel','efetivado','erro')),
  acao text NOT NULL DEFAULT 'revisar'
    CHECK (acao IN ('revisar','ignorar','vincular','criar_titulo','so_espelho')),
  party_id uuid REFERENCES public.parties(id),
  title_id uuid REFERENCES public.financial_titles(id),
  installment_id uuid REFERENCES public.financial_installments(id),
  charge_id uuid REFERENCES public.asaas_charges(id),
  motivo text,
  efetivado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, tipo, external_id)
);
GRANT SELECT ON public.asaas_import_stage TO authenticated;
GRANT ALL ON public.asaas_import_stage TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.asaas_import_stage FROM authenticated, anon;
ALTER TABLE public.asaas_import_stage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_import_stage_read ON public.asaas_import_stage;
CREATE POLICY asaas_import_stage_read ON public.asaas_import_stage FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));

ALTER TABLE public.asaas_import_findings DROP CONSTRAINT IF EXISTS asaas_import_findings_tipo_check;
ALTER TABLE public.asaas_import_findings ADD CONSTRAINT asaas_import_findings_tipo_check
  CHECK (tipo IN ('criaria_titulo','vinculo_sugerido','duplicidade_suspeita','cliente_ambiguo',
                  'cobranca_sem_titulo','titulo_sem_cobranca','cobranca_incompativel',
                  'pagamento_historico','saldo_inicial_pendente','erro'));

-- ---------------- intenção de cobrança ----------------
CREATE TABLE IF NOT EXISTS public.asaas_charge_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.asaas_accounts(id),
  title_id uuid NOT NULL REFERENCES public.financial_titles(id),
  installment_id uuid NOT NULL REFERENCES public.financial_installments(id),
  party_id uuid NOT NULL REFERENCES public.parties(id),
  customer_external_id text,
  criar_cliente boolean NOT NULL DEFAULT false,
  value_cents bigint NOT NULL CHECK (value_cents > 0),
  due_date date NOT NULL,
  billing_type text NOT NULL CHECK (billing_type IN ('BOLETO','PIX','CREDIT_CARD','UNDEFINED')),
  internal_reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  state text NOT NULL DEFAULT 'preparada'
    CHECK (state IN ('preparada','processando','criada','rejeitada','desconhecida','conciliacao','cancelada')),
  attempts integer NOT NULL DEFAULT 0,
  charge_id uuid REFERENCES public.asaas_charges(id),
  external_id text,
  invoice_url text,
  simulado boolean NOT NULL DEFAULT true,
  last_error text,
  worker text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS asaas_charge_intents_parcela_idx
  ON public.asaas_charge_intents (installment_id, state);
-- uma intenção viva por parcela
CREATE UNIQUE INDEX IF NOT EXISTS asaas_charge_intents_viva_uidx
  ON public.asaas_charge_intents (installment_id)
  WHERE state IN ('preparada','processando','criada','desconhecida','conciliacao');

GRANT SELECT ON public.asaas_charge_intents TO authenticated;
GRANT ALL ON public.asaas_charge_intents TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.asaas_charge_intents FROM authenticated, anon;
ALTER TABLE public.asaas_charge_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_charge_intents_read ON public.asaas_charge_intents;
CREATE POLICY asaas_charge_intents_read ON public.asaas_charge_intents FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(),'finance.receivable.view'));

CREATE TABLE IF NOT EXISTS public.asaas_charge_intent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES public.asaas_charge_intents(id) ON DELETE CASCADE,
  de text, para text, detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.asaas_charge_intent_events TO authenticated;
GRANT ALL ON public.asaas_charge_intent_events TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.asaas_charge_intent_events FROM authenticated, anon;
ALTER TABLE public.asaas_charge_intent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asaas_charge_intent_events_read ON public.asaas_charge_intent_events;
CREATE POLICY asaas_charge_intent_events_read ON public.asaas_charge_intent_events
  FOR SELECT TO authenticated USING (public.has_capability(auth.uid(),'finance.receivable.view'));

CREATE OR REPLACE FUNCTION public.asaas_intent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF coalesce(current_setting('lardann.asaas_intent', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Intenção de cobrança só pelas rotinas oficiais.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.installment_id IS DISTINCT FROM OLD.installment_id
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.value_cents IS DISTINCT FROM OLD.value_cents THEN
      RAISE EXCEPTION 'O conteúdo da intenção não muda depois de registrada.';
    END IF;
    IF OLD.state IN ('criada','rejeitada','cancelada') AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'Intenção já resolvida não volta de estado.';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS asaas_intent_guard ON public.asaas_charge_intents;
CREATE TRIGGER asaas_intent_guard BEFORE INSERT OR UPDATE ON public.asaas_charge_intents
  FOR EACH ROW EXECUTE FUNCTION public.asaas_intent_guard();

-- ---------------- saldo da parcela (fonte do servidor) ----------------
CREATE OR REPLACE FUNCTION public.fin_installment_saldo(_installment uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT i.valor_cents
       - coalesce((SELECT sum(a.valor_cents) FROM public.financial_allocations a
                    WHERE a.installment_id = i.id), 0)
    FROM public.financial_installments i WHERE i.id = _installment
$fn$;
REVOKE ALL ON FUNCTION public.fin_installment_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_installment_saldo(uuid) TO authenticated;

-- ============================================================
-- IMPORTAÇÃO
-- ============================================================

/** Abre (ou retoma) um lote. O estado é do servidor; o navegador só escolhe conta e recorte. */
CREATE OR REPLACE FUNCTION public.asaas_import_abrir(
  _account uuid, _kind text DEFAULT 'historica',
  _de date DEFAULT NULL, _ate date DEFAULT NULL, _page_size integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; conta record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF NOT public.has_capability(auth.uid(),'finance.import.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar recebíveis.';
  END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = _account;
  IF conta.id IS NULL THEN RAISE EXCEPTION 'Conta inexistente.'; END IF;
  IF conta.owner_entity_id IS NULL THEN
    RAISE EXCEPTION 'Conta sem empresa proprietária: resolva o cadastro antes de importar.';
  END IF;

  SELECT * INTO r FROM public.asaas_import_runs
   WHERE account_id = _account AND kind = _kind AND status IN ('preparada','em_andamento','pausada')
     AND window_start IS NOT DISTINCT FROM _de AND window_end IS NOT DISTINCT FROM _ate
   ORDER BY created_at DESC LIMIT 1;

  PERFORM set_config('lardann.asaas_import','on', true);
  IF r.id IS NULL THEN
    INSERT INTO public.asaas_import_runs
      (account_id, kind, mode, status, window_start, window_end, page_size,
       offset_atual, has_more, simulado, started_at, created_by)
    VALUES (_account, _kind, 'previa', 'em_andamento', _de, _ate, least(greatest(_page_size,1),100),
            0, true, conta.environment <> 'producao', now(), auth.uid())
    RETURNING * INTO r;
  ELSE
    UPDATE public.asaas_import_runs SET status = 'em_andamento' WHERE id = r.id RETURNING * INTO r;
  END IF;
  PERFORM set_config('lardann.asaas_import','off', true);

  RETURN jsonb_build_object('run_id', r.id, 'retomado', r.offset_atual > 0,
    'offset', r.offset_atual, 'page_size', r.page_size, 'has_more', r.has_more,
    'window_start', r.window_start, 'window_end', r.window_end, 'simulado', r.simulado);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_abrir(uuid,text,date,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_abrir(uuid,text,date,date,integer) TO authenticated;

/**
 * Registra uma página trazida pelo adaptador. Idempotente por (lote, tipo, id externo):
 * reprocessar a mesma página não duplica nada. Avança o deslocamento do servidor.
 */
CREATE OR REPLACE FUNCTION public.asaas_import_pagina(
  _run uuid, _offset integer, _itens jsonb, _has_more boolean, _clientes jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; e jsonb; novos integer := 0; repetidos integer := 0; ok boolean;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.import.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar recebíveis.';
  END IF;
  SELECT * INTO r FROM public.asaas_import_runs WHERE id = _run FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF r.status = 'concluida' THEN RAISE EXCEPTION 'Lote já concluído.'; END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_clientes,'[]'::jsonb)) LOOP
    INSERT INTO public.asaas_import_stage (run_id, account_id, tipo, external_id, payload)
    VALUES (_run, r.account_id, 'cliente', e->>'id', e)
    ON CONFLICT (run_id, tipo, external_id) DO NOTHING;
  END LOOP;

  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) LOOP
    IF coalesce(e->>'id','') = '' THEN RAISE EXCEPTION 'Cobrança sem identificador externo.'; END IF;
    INSERT INTO public.asaas_import_stage (run_id, account_id, tipo, external_id, payload)
    VALUES (_run, r.account_id, 'cobranca', e->>'id', e)
    ON CONFLICT (run_id, tipo, external_id) DO NOTHING;
    GET DIAGNOSTICS ok = ROW_COUNT;
    IF ok THEN novos := novos + 1; ELSE repetidos := repetidos + 1; END IF;
  END LOOP;

  PERFORM set_config('lardann.asaas_import','on', true);
  UPDATE public.asaas_import_runs
     SET offset_atual = greatest(offset_atual, coalesce(_offset,0) + jsonb_array_length(coalesce(_itens,'[]'::jsonb))),
         has_more = coalesce(_has_more,false),
         page = page + 1,
         status = CASE WHEN coalesce(_has_more,false) THEN 'em_andamento' ELSE 'pausada' END
   WHERE id = _run;
  PERFORM set_config('lardann.asaas_import','off', true);

  RETURN jsonb_build_object('run_id', _run, 'novos', novos, 'repetidos', repetidos,
    'offset', (SELECT offset_atual FROM public.asaas_import_runs WHERE id = _run),
    'has_more', coalesce(_has_more,false));
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_pagina(uuid,integer,jsonb,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_pagina(uuid,integer,jsonb,boolean,jsonb) TO authenticated;

/**
 * Classifica o que foi trazido. NÃO cria título, parcela nem baixa.
 * Pessoas nunca são ligadas por nome: só por vínculo externo já persistido.
 */
CREATE OR REPLACE FUNCTION public.asaas_import_previa(_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; s record; conta record; sistema text;
        v_party uuid; v_title uuid; v_charge uuid; v_class text; v_acao text; v_motivo text;
        v_dup uuid; v_pago boolean;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.import.run')
     AND NOT public.has_capability(auth.uid(),'finance.import.approve') THEN
    RAISE EXCEPTION 'Sem permissão para revisar a importação.';
  END IF;
  SELECT * INTO r FROM public.asaas_import_runs WHERE id = _run;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = r.account_id;
  sistema := public.asaas_origin_key(r.account_id);

  DELETE FROM public.asaas_import_findings WHERE run_id = _run AND resolvido = false;

  FOR s IN SELECT * FROM public.asaas_import_stage
            WHERE run_id = _run AND tipo = 'cobranca'
              AND classificacao NOT IN ('efetivado','vinculo_sugerido') LOOP
    v_party := NULL; v_title := NULL; v_charge := NULL; v_motivo := NULL; v_dup := NULL;
    v_class := 'novo'; v_acao := 'criar_titulo';

    SELECT id INTO v_charge FROM public.asaas_charges
      WHERE account_id = r.account_id AND external_id = s.external_id;

    SELECT cu.party_id INTO v_party FROM public.asaas_customers cu
      WHERE cu.account_id = r.account_id AND cu.external_id = s.payload->>'customer'
        AND cu.match_status = 'vinculado';

    SELECT id INTO v_title FROM public.financial_titles
      WHERE sistema_origem = sistema AND id_externo = s.external_id;

    v_pago := coalesce((s.payload->>'status'),'') IN ('RECEIVED','RECEIVED_IN_CASH','CONFIRMED')
              OR coalesce((s.payload->>'valuePaidCents')::bigint, 0) > 0;

    IF v_title IS NOT NULL THEN
      v_class := 'ja_existe'; v_acao := 'vincular';
      v_motivo := 'Título já importado antes deste lote: vincular, nunca criar outro.';
    ELSIF v_party IS NULL THEN
      v_class := 'cliente_ambiguo'; v_acao := 'revisar';
      v_motivo := 'Cliente externo sem pessoa vinculada. Revisar correspondência (nunca por nome).';
      INSERT INTO public.asaas_import_findings (run_id, charge_external_id, customer_external_id, tipo, detalhe)
      VALUES (_run, s.external_id, s.payload->>'customer', 'cliente_ambiguo',
              jsonb_build_object('nome_informado', s.payload->>'customerName'));
    ELSE
      -- duplicidade suspeita contra lançamento manual: mesma pessoa, mesmo valor, mesmo vencimento
      SELECT t.id INTO v_dup
        FROM public.financial_titles t
        JOIN public.financial_installments i ON i.title_id = t.id
       WHERE t.direction = 'receivable'
         AND t.party_id = v_party
         AND t.status <> 'cancelado'
         AND (t.sistema_origem IS DISTINCT FROM sistema)
         AND i.valor_cents = coalesce((s.payload->>'valueCents')::bigint, -1)
         AND i.vencimento = (s.payload->>'dueDate')::date
       LIMIT 1;
      IF v_dup IS NOT NULL THEN
        v_class := 'duplicidade_suspeita'; v_acao := 'revisar'; v_title := v_dup;
        v_motivo := 'Pode ser o mesmo recebível já lançado à mão. Revisar antes de efetivar.';
        INSERT INTO public.asaas_import_findings (run_id, charge_external_id, tipo, detalhe)
        VALUES (_run, s.external_id, 'duplicidade_suspeita',
                jsonb_build_object('title_id', v_dup));
      END IF;
    END IF;

    -- pagamento histórico: espelhamos, mas nunca criamos caixa por importação
    IF v_pago THEN
      INSERT INTO public.asaas_import_findings (run_id, charge_external_id, tipo, detalhe)
      VALUES (_run, s.external_id, 'pagamento_historico',
              jsonb_build_object(
                'aviso','Recebimento anterior ao uso do sistema. A importação não cria baixa: caixa histórico é decisão de abertura.',
                'estrategia_da_conta', conta.opening_balance_strategy,
                'valor_pago_cents', (s.payload->>'valuePaidCents')::bigint));
      IF conta.opening_balance_strategy = 'nao_definida' THEN
        INSERT INTO public.asaas_import_findings (run_id, charge_external_id, tipo, detalhe)
        VALUES (_run, s.external_id, 'saldo_inicial_pendente',
                jsonb_build_object('aviso','Estratégia de saldo inicial não definida para esta conta.'));
      END IF;
      IF v_class = 'novo' THEN v_class := 'historico'; v_acao := 'so_espelho';
        v_motivo := 'Histórico informativo: espelho sem título e sem baixa.'; END IF;
    END IF;

    IF v_class = 'novo' THEN
      INSERT INTO public.asaas_import_findings (run_id, charge_external_id, tipo, detalhe)
      VALUES (_run, s.external_id, 'criaria_titulo',
              jsonb_build_object('valor_cents', (s.payload->>'valueCents')::bigint,
                                 'vencimento', s.payload->>'dueDate'));
    END IF;

    UPDATE public.asaas_import_stage
       SET classificacao = v_class, acao = v_acao, party_id = v_party,
           title_id = v_title, charge_id = v_charge, motivo = v_motivo, updated_at = now()
     WHERE id = s.id;
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', _run,
    'total', (SELECT count(*) FROM public.asaas_import_stage WHERE run_id=_run AND tipo='cobranca'),
    'resumo', (SELECT coalesce(jsonb_object_agg(classificacao, n), '{}'::jsonb) FROM (
        SELECT classificacao, count(*) n FROM public.asaas_import_stage
         WHERE run_id=_run AND tipo='cobranca' GROUP BY 1) z),
    'pendencias', (SELECT count(*) FROM public.asaas_import_findings WHERE run_id=_run AND resolvido=false),
    'aviso', 'Prévia não cria título, parcela nem baixa.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_previa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_previa(uuid) TO authenticated;

/** Resolve uma pendência da prévia (pessoa, ação). Autor e horário são do servidor. */
CREATE OR REPLACE FUNCTION public.asaas_import_resolver(
  _stage uuid, _acao text, _party uuid DEFAULT NULL, _title uuid DEFAULT NULL, _motivo text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.import.approve') THEN
    RAISE EXCEPTION 'Sem permissão para resolver pendências da importação.';
  END IF;
  IF _acao NOT IN ('ignorar','vincular','criar_titulo','so_espelho') THEN
    RAISE EXCEPTION 'Ação inválida.';
  END IF;
  SELECT * INTO s FROM public.asaas_import_stage WHERE id = _stage FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Linha inexistente.'; END IF;
  IF s.classificacao = 'efetivado' THEN RAISE EXCEPTION 'Linha já efetivada.'; END IF;
  IF _acao IN ('vincular','criar_titulo') AND coalesce(_party, s.party_id) IS NULL THEN
    RAISE EXCEPTION 'Sem pessoa identificada não se cria nem vincula recebível.';
  END IF;
  IF _acao = 'vincular' AND coalesce(_title, s.title_id) IS NULL THEN
    RAISE EXCEPTION 'Vincular exige o título de destino.';
  END IF;

  UPDATE public.asaas_import_stage
     SET acao = _acao, party_id = coalesce(_party, party_id), title_id = coalesce(_title, title_id),
         motivo = coalesce(_motivo, motivo), classificacao = 'vinculo_sugerido', updated_at = now()
   WHERE id = _stage;
  UPDATE public.asaas_import_findings SET resolvido = true
   WHERE run_id = s.run_id AND charge_external_id = s.external_id
     AND tipo IN ('cliente_ambiguo','duplicidade_suspeita','criaria_titulo');

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(),'asaas.import.resolver','asaas_import_stage', _stage,
          jsonb_build_object('acao', _acao, 'motivo', _motivo));
  RETURN jsonb_build_object('id', _stage, 'acao', _acao);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_resolver(uuid,text,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_resolver(uuid,text,uuid,uuid,text) TO authenticated;

/** Aprovação: exige capacidade, sessão e lote com prévia feita. O servidor grava quem aprovou. */
CREATE OR REPLACE FUNCTION public.asaas_import_aprovar(_run uuid, _motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; pendentes integer; itens integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF NOT public.has_capability(auth.uid(),'finance.import.approve') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar importação.';
  END IF;
  SELECT * INTO r FROM public.asaas_import_runs WHERE id = _run FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF r.has_more THEN RAISE EXCEPTION 'Lote incompleto: ainda há páginas a buscar.'; END IF;
  SELECT count(*) INTO itens FROM public.asaas_import_stage WHERE run_id=_run AND tipo='cobranca';
  IF itens = 0 THEN RAISE EXCEPTION 'Lote vazio não se aprova.'; END IF;
  SELECT count(*) INTO pendentes FROM public.asaas_import_stage
   WHERE run_id=_run AND tipo='cobranca' AND acao = 'revisar' AND classificacao <> 'efetivado';
  IF pendentes > 0 THEN
    RAISE EXCEPTION 'Existem % linhas em revisão. Resolva antes de aprovar.', pendentes;
  END IF;
  IF r.approved_by IS NOT NULL THEN
    RETURN jsonb_build_object('run_id', _run, 'repetida', true, 'approved_by', r.approved_by);
  END IF;

  PERFORM set_config('lardann.asaas_import','on', true);
  UPDATE public.asaas_import_runs
     SET mode = 'efetivar', approved_by = auth.uid(), approved_at = now()
   WHERE id = _run;
  PERFORM set_config('lardann.asaas_import','off', true);

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(),'asaas.import.aprovar','asaas_import_runs', _run,
          jsonb_build_object('motivo', _motivo, 'itens', itens));
  RETURN jsonb_build_object('run_id', _run, 'repetida', false, 'itens', itens);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_aprovar(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_aprovar(uuid,text) TO authenticated;

/**
 * Efetiva o lote aprovado usando as rotinas canônicas do financeiro.
 * Cria título só quando a linha pede; vincula quando já existe; nunca dá baixa.
 */
CREATE OR REPLACE FUNCTION public.asaas_import_efetivar(_run uuid, _limite integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE r record; s record; conta record; sistema text;
        v_title uuid; v_inst uuid; v_charge uuid;
        criados integer := 0; vinculados integer := 0; espelhos integer := 0; ignorados integer := 0;
BEGIN
  -- Segregação (ajuste após o navegador isolado): a Diretoria aprova; quem
  -- efetiva é quem opera o contas a receber, porque a efetivação cria títulos
  -- pelas rotinas canônicas, que exigem finance.receivable.manage.
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF NOT public.has_capability(auth.uid(),'finance.import.run')
     OR NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão para efetivar importação.';
  END IF;
  SELECT * INTO r FROM public.asaas_import_runs WHERE id = _run FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF r.mode <> 'efetivar' OR r.approved_by IS NULL THEN
    RAISE EXCEPTION 'Lote não aprovado.';
  END IF;
  SELECT * INTO conta FROM public.asaas_accounts WHERE id = r.account_id;
  sistema := public.asaas_origin_key(r.account_id);

  FOR s IN SELECT * FROM public.asaas_import_stage
            WHERE run_id = _run AND tipo='cobranca' AND classificacao <> 'efetivado'
            ORDER BY created_at LIMIT greatest(_limite,1) FOR UPDATE LOOP
    IF s.acao = 'ignorar' THEN
      UPDATE public.asaas_import_stage SET classificacao='efetivado', efetivado_at=now() WHERE id=s.id;
      ignorados := ignorados + 1; CONTINUE;
    END IF;
    IF s.acao = 'revisar' THEN CONTINUE; END IF;

    -- espelho da cobrança: identidade conta + recurso externo
    SELECT id INTO v_charge FROM public.asaas_charges
      WHERE account_id = r.account_id AND external_id = s.external_id;
    IF v_charge IS NULL THEN
      INSERT INTO public.asaas_charges
        (account_id, external_id, customer_external_id, value_cents, net_value_cents, fee_cents,
         received_cents, due_date, payment_date, billing_type, external_status, reconcile_status, raw)
      VALUES (r.account_id, s.external_id, s.payload->>'customer',
              coalesce((s.payload->>'valueCents')::bigint,0),
              (s.payload->>'netValueCents')::bigint, (s.payload->>'feeCents')::bigint,
              (s.payload->>'valuePaidCents')::bigint,
              nullif(s.payload->>'dueDate','')::date, nullif(s.payload->>'paymentDate','')::date,
              coalesce(s.payload->>'billingType','UNDEFINED'), s.payload->>'status',
              'pendente', s.payload)
      RETURNING id INTO v_charge;
    END IF;

    v_title := s.title_id;
    IF s.acao = 'criar_titulo' AND v_title IS NULL THEN
      v_title := public.fin_title_create(jsonb_build_object(
        'direction','receivable',
        'business_entity_id', conta.owner_entity_id,
        'party_id', s.party_id,
        'descricao', coalesce(nullif(s.payload->>'description',''), 'Recebível importado do Asaas'),
        'valor_cents', (s.payload->>'valueCents')::bigint,
        'emissao', coalesce(nullif(s.payload->>'dateCreated',''), current_date::text),
        'origem','asaas', 'sistema_origem', sistema, 'id_externo', s.external_id,
        'status','ativo',
        'parcelas', jsonb_build_array(jsonb_build_object(
          'vencimento', s.payload->>'dueDate', 'valor_cents', (s.payload->>'valueCents')::bigint))));
      criados := criados + 1;
    END IF;

    IF v_title IS NOT NULL THEN
      SELECT id INTO v_inst FROM public.financial_installments
        WHERE title_id = v_title ORDER BY numero LIMIT 1;
      PERFORM set_config('lardann.asaas_link','on', true);
      UPDATE public.asaas_charges SET party_id = s.party_id WHERE id = v_charge;
      PERFORM set_config('lardann.asaas_link','off', true);
      PERFORM public.asaas_charge_vincular(v_charge, v_title, v_inst,
        'Importação ' || _run::text, false);
      vinculados := vinculados + 1;
    ELSE
      espelhos := espelhos + 1;
    END IF;

    UPDATE public.asaas_import_stage
       SET classificacao='efetivado', efetivado_at=now(), charge_id=v_charge, title_id=v_title,
           installment_id=v_inst, updated_at=now()
     WHERE id = s.id;
  END LOOP;

  PERFORM set_config('lardann.asaas_import','on', true);
  UPDATE public.asaas_import_runs
     SET imported = imported + criados + vinculados,
         status = CASE WHEN EXISTS (SELECT 1 FROM public.asaas_import_stage
                                     WHERE run_id=_run AND tipo='cobranca' AND classificacao<>'efetivado')
                       THEN 'em_andamento' ELSE 'concluida' END,
         finished_at = CASE WHEN EXISTS (SELECT 1 FROM public.asaas_import_stage
                                     WHERE run_id=_run AND tipo='cobranca' AND classificacao<>'efetivado')
                       THEN NULL ELSE now() END
   WHERE id = _run;
  PERFORM set_config('lardann.asaas_import','off', true);

  RETURN jsonb_build_object('run_id', _run, 'titulos_criados', criados,
    'vinculados', vinculados, 'somente_espelho', espelhos, 'ignorados', ignorados,
    'aviso','Nenhuma baixa foi criada pela importação.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_efetivar(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_efetivar(uuid,integer) TO authenticated;

-- ============================================================
-- INTENÇÃO DE COBRANÇA E LINK
-- ============================================================

/**
 * Prepara a intenção ANTES de qualquer chamada. Valor, pessoa e saldo vêm do servidor;
 * o que o navegador manda é apenas parcela, forma e vencimento.
 */
CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE conta record; i record; t record; cliente record; existente record; viva record;
        v_saldo bigint; v_hash text; v_ref text; v_key text; v_venc date; v_forma text; v_id uuid;
        v_party uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão obrigatória.'; END IF;
  IF NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão para preparar cobrança.';
  END IF;

  SELECT * INTO i FROM public.financial_installments
    WHERE id = (_payload->>'installment_id')::uuid FOR UPDATE;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Parcela inexistente.'; END IF;
  SELECT * INTO t FROM public.financial_titles WHERE id = i.title_id;
  IF t.direction <> 'receivable' THEN RAISE EXCEPTION 'Só há cobrança para título a receber.'; END IF;
  IF t.status <> 'ativo' THEN RAISE EXCEPTION 'Título não está ativo.'; END IF;
  IF t.approval_status = 'pendente' THEN RAISE EXCEPTION 'Título pendente de aprovação.'; END IF;

  v_saldo := public.fin_installment_saldo(i.id);
  IF coalesce(v_saldo,0) <= 0 THEN RAISE EXCEPTION 'Parcela sem saldo devido.'; END IF;

  SELECT * INTO conta FROM public.asaas_accounts WHERE id = (_payload->>'account_id')::uuid;
  IF conta.id IS NULL THEN RAISE EXCEPTION 'Conta inexistente.'; END IF;
  IF conta.owner_entity_id IS NULL THEN RAISE EXCEPTION 'Conta Asaas sem empresa proprietária.'; END IF;
  IF t.business_entity_id IS NULL THEN RAISE EXCEPTION 'Título sem empresa: pendência cadastral.'; END IF;
  IF t.business_entity_id <> conta.owner_entity_id THEN
    RAISE EXCEPTION 'A conta Asaas pertence a outra empresa que não a do título.';
  END IF;

  v_party := coalesce(t.pagador_party_id, t.party_id);
  SELECT * INTO cliente FROM public.asaas_customers
    WHERE account_id = conta.id AND party_id = v_party AND match_status = 'vinculado' LIMIT 1;
  IF cliente.id IS NULL AND coalesce((_payload->>'criar_cliente')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Devedor sem cliente externo vinculado. Prepare a criação do cliente explicitamente.';
  END IF;

  -- já existe cobrança ativa equivalente? então é ela que vale
  SELECT * INTO existente FROM public.asaas_charges
   WHERE installment_id = i.id AND account_id = conta.id
     AND coalesce(external_status,'') NOT IN ('DELETED','REFUNDED','CANCELED')
   LIMIT 1;
  IF existente.id IS NOT NULL THEN
    RETURN jsonb_build_object('reaproveitada', true, 'charge_id', existente.id,
      'external_id', existente.external_id,
      'invoice_url', coalesce(existente.invoice_url,
                       (SELECT invoice_url FROM public.asaas_charge_intents
                         WHERE charge_id = existente.id ORDER BY created_at DESC LIMIT 1)),
      'aviso','Já existe cobrança ativa para esta parcela. Nenhuma nova foi criada.');
  END IF;

  v_venc := coalesce(nullif(_payload->>'due_date','')::date, i.vencimento);
  IF v_venc < current_date THEN v_venc := current_date; END IF;
  v_forma := coalesce(nullif(_payload->>'billing_type',''),'UNDEFINED');
  v_ref := 'lardan:installment:' || i.id::text;
  -- tentativas encerradas (rejeitada/cancelada) não prendem a parcela: a chave
  -- padrão inclui quantas já houve, para que uma nova solicitação seja nova
  v_key := coalesce(nullif(_payload->>'idempotency_key',''),
    v_ref || ':' || v_saldo::text || ':' || v_venc::text || ':' ||
    (SELECT count(*) FROM public.asaas_charge_intents x
      WHERE x.installment_id = i.id AND x.state IN ('rejeitada','cancelada'))::text);
  v_hash := public.fin_fingerprint(jsonb_build_object(
    'account', conta.id, 'installment', i.id, 'party', v_party,
    'valor_cents', v_saldo, 'due_date', v_venc, 'billing_type', v_forma));

  SELECT * INTO existente FROM public.asaas_charge_intents WHERE idempotency_key = v_key;
  IF existente.id IS NOT NULL THEN
    IF existente.content_hash <> v_hash THEN
      RAISE EXCEPTION 'Colisão de chave: esta chave já foi usada com outro conteúdo.'
        USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object('id', existente.id, 'repetida', true, 'state', existente.state,
      'valor_cents', existente.value_cents, 'invoice_url', existente.invoice_url,
      'external_id', existente.external_id, 'simulado', existente.simulado,
      'due_date', existente.due_date, 'billing_type', existente.billing_type,
      'customer_external_id', existente.customer_external_id,
      'internal_reference', existente.internal_reference);
  END IF;

  SELECT * INTO viva FROM public.asaas_charge_intents
   WHERE installment_id = i.id AND state IN ('preparada','processando','criada','desconhecida','conciliacao') LIMIT 1;
  IF viva.id IS NOT NULL THEN
    RETURN jsonb_build_object('id', viva.id, 'repetida', true, 'state', viva.state,
      'valor_cents', viva.value_cents, 'invoice_url', viva.invoice_url,
      'external_id', viva.external_id, 'simulado', viva.simulado,
      'due_date', viva.due_date, 'billing_type', viva.billing_type,
      'customer_external_id', viva.customer_external_id,
      'internal_reference', viva.internal_reference,
      'aviso','Já havia uma intenção viva para esta parcela.');
  END IF;

  PERFORM set_config('lardann.asaas_intent','on', true);
  INSERT INTO public.asaas_charge_intents
    (account_id, title_id, installment_id, party_id, customer_external_id, criar_cliente,
     value_cents, due_date, billing_type, internal_reference, idempotency_key, content_hash,
     simulado, created_by)
  VALUES (conta.id, t.id, i.id, v_party, cliente.external_id, cliente.id IS NULL,
          v_saldo, v_venc, v_forma, v_ref || ':' || left(md5(v_key),8), v_key, v_hash,
          coalesce(conta.modo_execucao,'simulado') = 'simulado', auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
  VALUES (v_id, NULL, 'preparada', jsonb_build_object('valor_cents', v_saldo), auth.uid());
  PERFORM set_config('lardann.asaas_intent','off', true);

  RETURN jsonb_build_object('id', v_id, 'repetida', false, 'state','preparada',
    'valor_cents', v_saldo, 'due_date', v_venc, 'billing_type', v_forma,
    'customer_external_id', cliente.external_id, 'criar_cliente', cliente.id IS NULL,
    'internal_reference', v_ref || ':' || left(md5(v_key),8),
    'simulado', coalesce(conta.modo_execucao,'simulado') = 'simulado',
    'aviso','Intenção registrada. Gerar link não liquida parcela nem emite documento fiscal.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_preparar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_preparar(jsonb) TO authenticated;

/** Reserva a intenção para UM trabalhador. Transação curta: nada fica travado na rede. */
CREATE OR REPLACE FUNCTION public.asaas_cobranca_processando(_intent uuid, _worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE n integer; it record;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  PERFORM set_config('lardann.asaas_intent','on', true);
  UPDATE public.asaas_charge_intents
     SET state='processando', worker=_worker, processing_at=now(), attempts = attempts + 1
   WHERE id=_intent AND state='preparada';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('lardann.asaas_intent','off', true);
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id=_intent;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
  IF n = 1 THEN
    INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
    VALUES (_intent, 'preparada','processando', jsonb_build_object('worker',_worker), auth.uid());
  END IF;
  RETURN jsonb_build_object('id',_intent,'reservada', n = 1, 'state', it.state,
    'attempts', it.attempts, 'invoice_url', it.invoice_url, 'external_id', it.external_id);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_processando(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_processando(uuid,text) TO authenticated;

/**
 * Registra o resultado do adaptador. Estados distintos:
 * criada | rejeitada | desconhecida (resposta perdida) | conciliacao (saldo mudou).
 * O endereço da fatura vem do provedor; nunca é montado por concatenação.
 */
CREATE OR REPLACE FUNCTION public.asaas_cobranca_resultado(_intent uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE it record; res text; v_charge uuid; v_saldo bigint; v_url text;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id=_intent FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
  res := _payload->>'resultado';
  IF res NOT IN ('criada','rejeitada','desconhecida') THEN RAISE EXCEPTION 'Resultado inválido.'; END IF;
  IF it.state IN ('criada','rejeitada','cancelada') THEN
    RETURN jsonb_build_object('id', it.id, 'repetida', true, 'state', it.state,
      'invoice_url', it.invoice_url, 'external_id', it.external_id);
  END IF;

  PERFORM set_config('lardann.asaas_intent','on', true);

  IF res = 'rejeitada' THEN
    UPDATE public.asaas_charge_intents
       SET state='rejeitada', last_error=left(coalesce(_payload->>'erro','Rejeitada pelo provedor'),500),
           resolved_at=now()
     WHERE id=_intent;
  ELSIF res = 'desconhecida' THEN
    UPDATE public.asaas_charge_intents
       SET state='desconhecida', last_error=left(coalesce(_payload->>'erro','Resposta não recebida'),500)
     WHERE id=_intent;
  ELSE
    IF coalesce(_payload->>'external_id','') = '' OR coalesce(_payload->>'invoice_url','') = '' THEN
      RAISE EXCEPTION 'Cobrança criada sem identificador ou sem endereço devolvido pelo provedor.';
    END IF;
    v_url := _payload->>'invoice_url';
    IF it.simulado AND v_url NOT LIKE '/financeiro/simulacao/%' THEN
      RAISE EXCEPTION 'Em simulação o endereço tem de ser local e identificado como demonstração.';
    END IF;
    IF NOT it.simulado AND v_url NOT LIKE 'https://%' THEN
      RAISE EXCEPTION 'Endereço de fatura inválido.';
    END IF;

    v_saldo := public.fin_installment_saldo(it.installment_id);
    IF v_saldo IS DISTINCT FROM it.value_cents THEN
      -- o provedor criou, mas o saldo mudou no meio: nunca uma segunda cobrança silenciosa
      UPDATE public.asaas_charge_intents
         SET state='conciliacao', external_id=_payload->>'external_id', invoice_url=v_url,
             last_error='Saldo da parcela mudou durante o processamento.'
       WHERE id=_intent;
      PERFORM set_config('lardann.asaas_intent','off', true);
      INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (_intent, it.state, 'conciliacao',
              jsonb_build_object('saldo_atual', v_saldo, 'valor_intencao', it.value_cents), auth.uid());
      RETURN jsonb_build_object('id',_intent,'state','conciliacao','invoice_url', v_url,
        'aviso','Cobrança existe no provedor, mas o saldo mudou. Encaminhado para conciliação.');
    END IF;

    SELECT id INTO v_charge FROM public.asaas_charges
      WHERE account_id = it.account_id AND external_id = _payload->>'external_id';
    IF v_charge IS NULL THEN
      PERFORM set_config('lardann.asaas_link','on', true);
      INSERT INTO public.asaas_charges
        (account_id, external_id, customer_external_id, value_cents, due_date, billing_type,
         external_status, party_id, reconcile_status, raw)
      VALUES (it.account_id, _payload->>'external_id', it.customer_external_id, it.value_cents,
              it.due_date, it.billing_type, coalesce(_payload->>'status','PENDING'), it.party_id,
              'pendente', coalesce(_payload->'raw','{}'::jsonb))
      RETURNING id INTO v_charge;
      PERFORM set_config('lardann.asaas_link','off', true);
    END IF;
    PERFORM public.asaas_charge_vincular(v_charge, it.title_id, it.installment_id,
      'Cobrança preparada pela Lardan', false);

    UPDATE public.asaas_charge_intents
       SET state='criada', external_id=_payload->>'external_id', invoice_url=v_url,
           charge_id=v_charge, resolved_at=now(), last_error=NULL
     WHERE id=_intent;
  END IF;

  PERFORM set_config('lardann.asaas_intent','off', true);
  SELECT * INTO it FROM public.asaas_charge_intents WHERE id=_intent;
  INSERT INTO public.asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
  VALUES (_intent, 'processando', it.state, jsonb_build_object('external_id', it.external_id), auth.uid());

  RETURN jsonb_build_object('id',_intent,'state',it.state,'invoice_url',it.invoice_url,
    'external_id', it.external_id, 'charge_id', it.charge_id, 'simulado', it.simulado,
    'aviso','Gerar link não liquida a parcela, não comprova venda e não emite nota fiscal.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_cobranca_resultado(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_cobranca_resultado(uuid,jsonb) TO authenticated;

-- ============================================================
-- EVENTOS
-- ============================================================

/** Persiste o evento antes de qualquer efeito. Deduplica por conta + ID externo. */
CREATE OR REPLACE FUNCTION public.asaas_evento_registrar(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE conta uuid; v_id uuid; novo boolean := true; tipo record;
BEGIN
  conta := (_payload->>'account_id')::uuid;
  IF conta IS NULL THEN RAISE EXCEPTION 'Evento sem conta.'; END IF;
  IF coalesce(_payload->>'external_id','') = '' THEN RAISE EXCEPTION 'Evento sem identificador.'; END IF;
  IF coalesce(_payload->>'event','') = '' THEN RAISE EXCEPTION 'Evento sem tipo.'; END IF;
  IF length(_payload::text) > 200000 THEN RAISE EXCEPTION 'Mensagem grande demais.'; END IF;

  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = _payload->>'event';

  INSERT INTO public.asaas_events
    (account_id, external_id, event, charge_external_id, event_at, received_at, status,
     classification, payload)
  VALUES (conta, _payload->>'external_id', _payload->>'event', _payload->>'charge_external_id',
          coalesce(nullif(_payload->>'event_at','')::timestamptz, now()), now(), 'na_fila',
          CASE WHEN tipo.event IS NULL THEN 'desconhecido' ELSE 'conhecido' END,
          coalesce(_payload->'payload','{}'::jsonb))
  ON CONFLICT (account_id, external_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    novo := false;
    SELECT id INTO v_id FROM public.asaas_events
      WHERE account_id = conta AND external_id = _payload->>'external_id';
  END IF;
  RETURN jsonb_build_object('id', v_id, 'novo', novo,
    'conhecido', tipo.event IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_evento_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_evento_registrar(jsonb) TO authenticated;

/**
 * Aplica a matriz ao espelho da cobrança. NÃO cria baixa: a regra contábil do
 * recebimento ainda não está definida, então a ocorrência fica pendente de revisão.
 */
CREATE OR REPLACE FUNCTION public.asaas_evento_processar(_evento uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE e record; tipo record; c record; p jsonb; atrasado boolean := false;
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.reconcile') THEN
    RAISE EXCEPTION 'Sem permissão para conciliar eventos.';
  END IF;
  SELECT * INTO e FROM public.asaas_events WHERE id=_evento FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Evento inexistente.'; END IF;
  IF e.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', e.id, 'repetido', true, 'status', e.status);
  END IF;
  SELECT * INTO tipo FROM public.asaas_event_types WHERE event = e.event;
  p := coalesce(e.payload,'{}'::jsonb);

  SELECT * INTO c FROM public.asaas_charges
    WHERE account_id = e.account_id AND external_id = e.charge_external_id FOR UPDATE;

  IF tipo.event IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='desconhecido',
      last_error='Tipo de evento não catalogado.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','tipo_desconhecido');
  END IF;

  IF c.id IS NULL THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento sem cobrança espelhada.', attempts = attempts + 1 WHERE id=e.id;
    RETURN jsonb_build_object('id', e.id, 'status','na_fila','motivo','sem_cobranca');
  END IF;

  -- evento atrasado não sobrescreve situação mais recente
  IF c.updated_at > e.event_at AND c.external_status IS DISTINCT FROM tipo.estado_externo
     AND EXISTS (SELECT 1 FROM public.asaas_events z
                  WHERE z.account_id=e.account_id AND z.charge_external_id=e.charge_external_id
                    AND z.processed_at IS NOT NULL AND z.event_at > e.event_at) THEN
    atrasado := true;
  END IF;

  PERFORM set_config('lardann.asaas_link','on', true);
  IF atrasado THEN
    UPDATE public.asaas_events SET status='na_fila', classification='revisao',
      last_error='Evento anterior a uma situação mais recente: exige conciliação.',
      processed_at=now() WHERE id=e.id;
  ELSE
    UPDATE public.asaas_charges SET
      external_status = tipo.estado_externo,
      received_cents = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN (p->>'valuePaidCents')::bigint ELSE received_cents END,
      fee_cents      = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN (p->>'feeCents')::bigint ELSE fee_cents END,
      net_value_cents= CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN (p->>'netValueCents')::bigint ELSE net_value_cents END,
      refunded_cents = CASE WHEN tipo.estorno IN ('total','parcial')
                            THEN (p->>'refundedCents')::bigint ELSE refunded_cents END,
      payment_date   = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                            THEN coalesce(nullif(p->>'paymentDate','')::date, payment_date)
                            ELSE payment_date END,
      credit_date    = CASE WHEN tipo.efeito_caixa = 'credita_conta_asaas'
                            THEN coalesce(nullif(p->>'creditDate','')::date, credit_date)
                            ELSE credit_date END
    WHERE id = c.id;

    UPDATE public.asaas_events SET
      status = CASE WHEN tipo.revisao_manual OR tipo.efeito_recebivel <> 'espelha'
                    THEN 'na_fila' ELSE 'processado' END,
      classification = CASE WHEN tipo.revisao_manual THEN 'revisao' ELSE 'conhecido' END,
      processed_at = now(),
      last_error = CASE WHEN tipo.efeito_recebivel = 'recebimento_registrado'
                        THEN 'Recebimento espelhado. A baixa depende de regra contábil ainda não definida.'
                        WHEN tipo.revisao_manual THEN 'Ocorrência pendente de decisão humana.'
                        ELSE NULL END
     WHERE id = e.id;
  END IF;
  PERFORM set_config('lardann.asaas_link','off', true);

  RETURN jsonb_build_object('id', e.id, 'atrasado', atrasado,
    'estado_externo', tipo.estado_externo, 'efeito_recebivel', tipo.efeito_recebivel,
    'efeito_caixa', tipo.efeito_caixa, 'estorno', tipo.estorno,
    'revisao_manual', tipo.revisao_manual, 'baixa_criada', false,
    'aviso','Nenhuma baixa nasce de evento: a regra contábil do recebimento continua pendente.');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_evento_processar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_evento_processar(uuid) TO authenticated;

-- ---------------- leitura para as telas ----------------
/** Recebíveis com a situação da cobrança Asaas ao lado. */
CREATE OR REPLACE FUNCTION public.asaas_receber_painel(_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE lim integer := least(greatest(coalesce((_filtros->>'limit')::int,50),1),200);
        off integer := greatest(coalesce((_filtros->>'offset')::int,0),0);
BEGIN
  IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  RETURN jsonb_build_object(
    'itens', coalesce((SELECT jsonb_agg(x ORDER BY x->>'vencimento') FROM (
      SELECT jsonb_build_object(
        'installment_id', i.id, 'title_id', t.id, 'numero', t.numero,
        'descricao', t.descricao, 'pessoa', pa.display_name,
        'vencimento', i.vencimento, 'valor_cents', i.valor_cents,
        'saldo_cents', public.fin_installment_saldo(i.id),
        'settlement_status', i.settlement_status,
        'cobranca', (SELECT jsonb_build_object('id', ch.id, 'external_id', ch.external_id,
                            'status', ch.external_status, 'billing_type', ch.billing_type)
                       FROM public.asaas_charges ch WHERE ch.installment_id = i.id
                      ORDER BY ch.imported_at DESC LIMIT 1),
        'intencao', (SELECT jsonb_build_object('id', ci.id, 'state', ci.state,
                            'invoice_url', ci.invoice_url, 'simulado', ci.simulado)
                       FROM public.asaas_charge_intents ci WHERE ci.installment_id = i.id
                      ORDER BY ci.created_at DESC LIMIT 1)) AS x
        FROM public.financial_installments i
        JOIN public.financial_titles t ON t.id = i.title_id
        LEFT JOIN public.parties pa ON pa.id = coalesce(t.pagador_party_id, t.party_id)
       WHERE t.direction = 'receivable' AND t.status <> 'cancelado'
       ORDER BY i.vencimento LIMIT lim OFFSET off) z), '[]'::jsonb),
    'fila_erros', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id, 'state', ci.state, 'erro', ci.last_error, 'attempts', ci.attempts,
        'installment_id', ci.installment_id))
       FROM public.asaas_charge_intents ci
      WHERE ci.state IN ('desconhecida','rejeitada','conciliacao')), '[]'::jsonb),
    -- corrigido após a validação no navegador isolado: ORDER BY/LIMIT fora do
    -- agregado era recusado pelo Postgres assim que existia uma ocorrência.
    'ocorrencias', coalesce((SELECT jsonb_agg(o ORDER BY o->>'quando' DESC) FROM (
       SELECT jsonb_build_object(
        'id', ev.id, 'event', ev.event, 'status', ev.status, 'classificacao', ev.classification,
        'cobranca', ev.charge_external_id, 'quando', ev.event_at, 'nota', ev.last_error) AS o
       FROM public.asaas_events ev WHERE ev.status = 'na_fila'
      ORDER BY ev.event_at DESC LIMIT 50) q), '[]'::jsonb),
    'contas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.label,
        'ambiente', a.environment, 'estado', a.state, 'conectada', a.is_active,
        'empresa', a.owner_entity_id))
       FROM public.asaas_accounts a), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_painel(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_painel(jsonb) TO authenticated;

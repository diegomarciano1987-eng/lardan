
-- 1) Kanban: nova tarefa manual encerra as anteriores abertas da mesma pessoa
CREATE OR REPLACE FUNCTION public.cob_tarefa_substitui_anteriores()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(NEW.origem,'') <> 'regua' AND NEW.status='aberta' THEN
    UPDATE cob_tarefas SET status='concluida', concluida_por=NEW.autor_id, concluida_em=now(),
           motivo_fim='Substituída por novo follow-up: '||left(NEW.titulo,80)
     WHERE party_id=NEW.party_id AND status='aberta' AND id<>NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cob_tarefa_substitui ON public.cob_tarefas;
CREATE TRIGGER trg_cob_tarefa_substitui AFTER INSERT ON public.cob_tarefas
  FOR EACH ROW EXECUTE FUNCTION public.cob_tarefa_substitui_anteriores();

-- 2) Conciliação automática do extrato Asaas com a baixa oficial já lançada
CREATE OR REPLACE FUNCTION public.fin_asaas_extrato_autoconciliar(_payment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s financial_settlements%rowtype; v_bruto bigint; v_liq bigint; v_lin uuid[]; v_soma bigint; v_fee_soma bigint; v_rec uuid; v_key text;
BEGIN
  IF _payment IS NULL OR _payment !~ '^pay_' THEN RETURN jsonb_build_object('ok',false,'motivo','sem_pagamento'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('asaas_extrato_auto:'||_payment));
  SELECT * INTO s FROM financial_settlements x
   WHERE x.idempotency_key LIKE 'asaas:baixa:%:'||_payment AND NOT x.is_reversal
     AND NOT EXISTS (SELECT 1 FROM financial_settlements r WHERE r.reversed_of=x.id)
   LIMIT 1;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','sem_baixa'); END IF;
  IF EXISTS (SELECT 1 FROM financial_reconciliations rc WHERE rc.settlement_id=s.id AND NOT rc.is_reversal
             AND NOT EXISTS (SELECT 1 FROM financial_reconciliations rr WHERE rr.reversed_of=rc.id)) THEN
    RETURN jsonb_build_object('ok',false,'motivo','ja_conciliada'); END IF;
  SELECT coalesce(sum(valor_cents) FILTER (WHERE kind='entrada'),0), coalesce(sum(valor_cents),0)
    INTO v_bruto, v_liq FROM financial_account_movements WHERE settlement_id=s.id;
  SELECT array_agg(id ORDER BY line_no), sum(CASE WHEN kind='entrada' THEN valor_cents-conciliado_cents ELSE -(valor_cents-conciliado_cents) END),
         coalesce(sum(valor_cents) FILTER (WHERE raw->>'type'='PAYMENT_FEE'),0)
    INTO v_lin, v_soma, v_fee_soma
    FROM financial_statement_lines
   WHERE financial_account_id=s.financial_account_id AND status IN ('pendente','parcial')
     AND raw->>'paymentId'=_payment AND raw->>'type' IN ('PAYMENT_RECEIVED','PAYMENT_FEE');
  IF v_lin IS NULL OR NOT EXISTS (SELECT 1 FROM financial_statement_lines WHERE id=ANY(v_lin) AND raw->>'type'='PAYMENT_RECEIVED') THEN
    RETURN jsonb_build_object('ok',false,'motivo','sem_linha'); END IF;
  -- com a linha da tarifa: precisa bater o líquido; sem ela (já usada antes): precisa bater o bruto
  IF NOT ((v_fee_soma>0 AND v_soma=v_liq) OR (v_fee_soma=0 AND v_soma=v_bruto)) THEN
    RETURN jsonb_build_object('ok',false,'motivo','valor_diferente','extrato',v_soma,'baixa_liq',v_liq,'baixa_bruto',v_bruto); END IF;
  v_key := 'asaas:extrato-auto:'||_payment;
  INSERT INTO financial_reconciliations (financial_account_id, settlement_id, idempotency_key, payload_fingerprint, observacao, created_by)
  VALUES (s.financial_account_id, s.id, v_key, md5(v_key||array_to_string(v_lin,',')), 'Conciliação automática: recebimento confirmado pelo Asaas', NULL)
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_rec;
  IF v_rec IS NULL THEN RETURN jsonb_build_object('ok',false,'motivo','repetido'); END IF;
  INSERT INTO financial_reconciliation_allocations (reconciliation_id, line_id, installment_id, valor_cents)
  SELECT v_rec, x.id, NULL, x.valor_cents-x.conciliado_cents FROM financial_statement_lines x WHERE x.id=ANY(v_lin);
  UPDATE financial_statement_lines SET conciliado_cents=valor_cents, status='conciliada', updated_at=now() WHERE id=ANY(v_lin);
  INSERT INTO financial_reconciliation_events (reconciliation_id, evento, payload, actor_id)
  VALUES (v_rec,'conciliado',jsonb_build_object('settlement_id',s.id,'payment',_payment,'linhas',to_jsonb(v_lin),'modo','asaas_automatico'),NULL);
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (NULL,'fin.extrato_asaas_autoconciliado','financial_reconciliations',v_rec,
          jsonb_build_object('payment',_payment,'settlement_id',s.id,'linhas',to_jsonb(v_lin),'valor_extrato',v_soma));
  RETURN jsonb_build_object('ok',true,'reconciliation_id',v_rec,'linhas',to_jsonb(v_lin));
END $$;
REVOKE ALL ON FUNCTION public.fin_asaas_extrato_autoconciliar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_asaas_extrato_autoconciliar(text) TO service_role;

CREATE OR REPLACE FUNCTION public.fin_asaas_extrato_auto_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p text;
BEGIN
  IF TG_TABLE_NAME='financial_settlements' THEN
    IF NEW.idempotency_key LIKE 'asaas:baixa:%' AND NOT NEW.is_reversal THEN p := regexp_replace(NEW.idempotency_key,'^.*:',''); END IF;
  ELSE
    IF NEW.status='pendente' AND NEW.raw->>'type' IN ('PAYMENT_RECEIVED','PAYMENT_FEE') THEN p := NEW.raw->>'paymentId'; END IF;
  END IF;
  IF p IS NOT NULL THEN
    BEGIN PERFORM public.fin_asaas_extrato_autoconciliar(p);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO audit_logs(actor_id, action, entity, payload)
      VALUES (NULL,'fin.extrato_asaas_autoconciliar_falhou',TG_TABLE_NAME,jsonb_build_object('payment',p,'erro',SQLERRM));
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fin_asaas_extrato_auto_s ON public.financial_settlements;
CREATE CONSTRAINT TRIGGER trg_fin_asaas_extrato_auto_s AFTER INSERT ON public.financial_settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fin_asaas_extrato_auto_trg();
DROP TRIGGER IF EXISTS trg_fin_asaas_extrato_auto_l ON public.financial_statement_lines;
CREATE CONSTRAINT TRIGGER trg_fin_asaas_extrato_auto_l AFTER INSERT ON public.financial_statement_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.fin_asaas_extrato_auto_trg();

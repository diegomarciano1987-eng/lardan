-- ============================================================
-- 10 · Produção habilitada + processamento de eventos pelo webhook
-- ============================================================

ALTER TABLE public.asaas_accounts DROP CONSTRAINT IF EXISTS asaas_accounts_estado_canonico_ck;
ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_estado_canonico_ck CHECK (
  (state='preparada' AND is_active=false AND modo_execucao='conectado' AND ambiente_provedor=environment
    AND config_status='preparado_rede_bloqueada') OR
  (state='simulada' AND is_active=true AND modo_execucao='simulado' AND ambiente_provedor IS NULL
    AND environment='sandbox' AND secret_ref IS NULL AND config_status='simulacao_isolada') OR
  (state='sandbox_conectada' AND is_active=true AND modo_execucao='conectado' AND environment='sandbox'
    AND ambiente_provedor='sandbox' AND secret_ref LIKE 'ASAAS_SANDBOX_%'
    AND config_status='sandbox_configurado') OR
  (state='producao_conectada' AND is_active=true AND modo_execucao='conectado' AND environment='producao'
    AND ambiente_provedor='producao' AND secret_ref LIKE 'ASAAS_PRODUCAO_%'
    AND config_status='producao_configurada') OR
  (state='suspensa' AND is_active=false AND config_status='conta_suspensa'));

CREATE OR REPLACE FUNCTION public.asaas_account_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.is_active:=NEW.state IN('simulada','sandbox_conectada','producao_conectada');
    NEW.modo_execucao:=CASE WHEN NEW.state='simulada' THEN 'simulado' ELSE 'conectado' END;
    NEW.ambiente_provedor:=CASE WHEN NEW.state='simulada' THEN NULL ELSE NEW.environment END;
    NEW.config_status:=CASE NEW.state WHEN 'simulada' THEN 'simulacao_isolada'
      WHEN 'sandbox_conectada' THEN 'sandbox_configurado'
      WHEN 'producao_conectada' THEN 'producao_configurada'
      WHEN 'suspensa' THEN 'conta_suspensa' ELSE 'preparado_rede_bloqueada' END;
    IF NEW.owner_entity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.asaas_accounts
      WHERE owner_entity_id=NEW.owner_entity_id AND billing_default) THEN NEW.billing_default:=true; END IF;
  END IF;
  IF TG_OP='UPDATE' AND coalesce(current_setting('lardann.asaas_account_config',true),'off') <> 'on'
     AND (NEW.environment,NEW.state,NEW.is_active,NEW.modo_execucao,NEW.ambiente_provedor,
          NEW.secret_ref,NEW.webhook_secret_ref,NEW.external_account_id,NEW.invoice_host_confirmed)
         IS DISTINCT FROM
         (OLD.environment,OLD.state,OLD.is_active,OLD.modo_execucao,OLD.ambiente_provedor,
          OLD.secret_ref,OLD.webhook_secret_ref,OLD.external_account_id,OLD.invoice_host_confirmed) THEN
    RAISE EXCEPTION 'Configuração crítica da conta só muda pela rotina oficial.';
  END IF;
  IF TG_OP='UPDATE' AND NEW.environment <> OLD.environment THEN
    RAISE EXCEPTION 'O ambiente da conta não muda depois de criada.';
  END IF;
  IF NEW.secret_ref IS NOT NULL AND NEW.webhook_secret_ref IS NOT NULL
     AND NEW.secret_ref=NEW.webhook_secret_ref THEN
    RAISE EXCEPTION 'Token do webhook deve ser diferente da chave da API.';
  END IF;
  NEW.updated_at:=now(); RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.asaas_account_configurar(_account uuid,_state text,_secret_ref text DEFAULT NULL,
  _webhook_secret_ref text DEFAULT NULL,_external_account_id text DEFAULT NULL,_invoice_host_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.settings.manage') THEN
    RAISE EXCEPTION 'Sem permissão para configurar a conta.';
  END IF;
  IF _state NOT IN ('preparada','simulada','sandbox_conectada','producao_conectada','suspensa') THEN
    RAISE EXCEPTION 'Estado não habilitado.';
  END IF;
  SELECT * INTO a FROM public.asaas_accounts WHERE id=_account FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Conta inexistente.'; END IF;
  IF a.environment='producao' AND _state NOT IN ('preparada','producao_conectada','suspensa') THEN
    RAISE EXCEPTION 'Conta de produção não muda para %.',_state;
  END IF;
  IF a.environment='sandbox' AND _state='producao_conectada' THEN
    RAISE EXCEPTION 'Conta de sandbox não vira produção; o ambiente não muda depois de criada.';
  END IF;
  PERFORM set_config('lardann.asaas_account_config','on',true);
  UPDATE public.asaas_accounts SET
    state=_state,
    is_active=_state IN ('simulada','sandbox_conectada','producao_conectada'),
    modo_execucao=CASE WHEN _state='simulada' THEN 'simulado' ELSE 'conectado' END,
    ambiente_provedor=CASE WHEN _state='simulada' THEN NULL ELSE environment END,
    secret_ref=CASE WHEN _state IN ('sandbox_conectada','producao_conectada') THEN _secret_ref ELSE NULL END,
    webhook_secret_ref=CASE WHEN _state IN ('sandbox_conectada','producao_conectada') THEN _webhook_secret_ref ELSE NULL END,
    external_account_id=coalesce(_external_account_id,external_account_id),
    invoice_host_confirmed=CASE WHEN _state='sandbox_conectada' THEN _invoice_host_confirmed ELSE false END,
    config_status=CASE _state WHEN 'simulada' THEN 'simulacao_isolada'
      WHEN 'sandbox_conectada' THEN 'sandbox_configurado'
      WHEN 'producao_conectada' THEN 'producao_configurada'
      WHEN 'suspensa' THEN 'conta_suspensa' ELSE 'preparado_rede_bloqueada' END,
    config_version=config_version+1
  WHERE id=_account RETURNING * INTO a;
  PERFORM set_config('lardann.asaas_account_config','off',true);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES(auth.uid(),'asaas.account.configurar','asaas_accounts',_account,
    jsonb_build_object('state',a.state,'environment',a.environment,'config_version',a.config_version));
  RETURN jsonb_build_object('id',a.id,'estado',a.state,'situacao',a.config_status);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_account_configurar(uuid,text,text,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asaas_account_configurar(uuid,text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.asaas_exec_config(_account uuid,_operacao text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.asaas_accounts WHERE id=_account;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Conta inexistente.'; END IF;
  IF a.state IN ('preparada','suspensa') OR NOT a.is_active THEN
    RAISE EXCEPTION 'Conta não executável: %.',a.state;
  END IF;
  IF a.state='simulada' AND (a.modo_execucao<>'simulado' OR a.ambiente_provedor IS NOT NULL) THEN
    RAISE EXCEPTION 'Configuração incoerente.';
  END IF;
  IF a.state='sandbox_conectada' AND (a.modo_execucao<>'conectado' OR a.ambiente_provedor<>'sandbox'
      OR a.secret_ref IS NULL) THEN RAISE EXCEPTION 'Configuração incoerente.'; END IF;
  IF a.state='producao_conectada' AND (a.modo_execucao<>'conectado' OR a.ambiente_provedor<>'producao'
      OR a.secret_ref IS NULL) THEN RAISE EXCEPTION 'Configuração incoerente.'; END IF;
  RETURN jsonb_build_object('account_id',a.id,'state',a.state,'modo',a.modo_execucao,
    'ambiente',a.ambiente_provedor,'secret_ref',a.secret_ref,'webhook_secret_ref',a.webhook_secret_ref,
    'external_account_id',a.external_account_id,'invoice_host_confirmed',a.invoice_host_confirmed,
    'operacao',_operacao);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_config(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_config(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_conta_situacao(_account uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.asaas_accounts WHERE id=_account;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Conta de cobrança inexistente.'); END IF;
  IF a.state='suspensa' THEN RETURN jsonb_build_object('ok',false,'situacao','conta_suspensa','motivo','Conta de cobrança suspensa.','account_id',a.id); END IF;
  IF a.state='preparada' THEN RETURN jsonb_build_object('ok',false,'situacao','preparada','motivo','Conta preparada, ainda não habilitada para operar.','account_id',a.id); END IF;
  IF NOT a.is_active OR a.config_status NOT IN ('simulacao_isolada','sandbox_configurado','producao_configurada') THEN
    RETURN jsonb_build_object('ok',false,'situacao','indisponivel','motivo','Configuração da conta incoerente.','account_id',a.id);
  END IF;
  RETURN jsonb_build_object('ok',true,'account_id',a.id,'state',a.state,'modo',a.modo_execucao,
    'ambiente',a.ambiente_provedor,'secret_ref',a.secret_ref,'external_account_id',a.external_account_id,
    'invoice_host_confirmed',a.invoice_host_confirmed,
    'situacao',CASE a.state WHEN 'simulada' THEN 'simulada'
                            WHEN 'producao_conectada' THEN 'producao_configurado'
                            ELSE 'sandbox_configurado' END);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_conta_situacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.asaas_evento_processar(_evento uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE e record; tipo record; c record; p jsonb; atrasado boolean := false;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_capability(auth.uid(),'finance.reconcile') THEN
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
GRANT EXECUTE ON FUNCTION public.asaas_evento_processar(uuid) TO authenticated, service_role;

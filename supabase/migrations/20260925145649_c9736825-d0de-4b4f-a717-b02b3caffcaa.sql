
-- Fechamento final da preparação Asaas. Pendente: somente ambiente isolado.
ALTER TABLE public.asaas_accounts
  ADD COLUMN IF NOT EXISTS config_status text NOT NULL DEFAULT 'preparado_rede_bloqueada',
  ADD COLUMN IF NOT EXISTS invoice_host_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_default boolean NOT NULL DEFAULT false;

WITH escolhida AS (SELECT DISTINCT ON(owner_entity_id) id FROM public.asaas_accounts
 WHERE owner_entity_id IS NOT NULL ORDER BY owner_entity_id,created_at,id)
UPDATE public.asaas_accounts a SET billing_default=true FROM escolhida e WHERE a.id=e.id;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_accounts_billing_default_uidx ON public.asaas_accounts(owner_entity_id)
 WHERE billing_default AND owner_entity_id IS NOT NULL;

-- Normalização explícita antes das restrições. Nada é promovido a conectado.
UPDATE public.asaas_accounts SET
  is_active = CASE WHEN state='simulada' THEN true ELSE false END,
  modo_execucao = CASE WHEN state='simulada' THEN 'simulado' ELSE 'conectado' END,
  ambiente_provedor = CASE WHEN state='simulada' THEN NULL ELSE environment END,
  secret_ref = CASE WHEN state='sandbox_conectada' THEN secret_ref ELSE NULL END,
  config_status = CASE state WHEN 'simulada' THEN 'simulacao_isolada'
    WHEN 'suspensa' THEN 'conta_suspensa' ELSE 'preparado_rede_bloqueada' END;

ALTER TABLE public.asaas_accounts DROP CONSTRAINT IF EXISTS asaas_accounts_secret_ck;
ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_secret_ck CHECK (
  secret_ref IS NULL OR secret_ref ~ '^ASAAS_(SANDBOX|PRODUCAO)_[A-Z0-9_]{1,48}$');
ALTER TABLE public.asaas_accounts DROP CONSTRAINT IF EXISTS asaas_accounts_webhook_secret_ck;
ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_webhook_secret_ck CHECK (
  webhook_secret_ref IS NULL OR webhook_secret_ref ~ '^ASAAS_WEBHOOK_[A-Z0-9_]{1,48}$');
ALTER TABLE public.asaas_accounts DROP CONSTRAINT IF EXISTS asaas_accounts_config_status_ck;
ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_config_status_ck CHECK (
  config_status IN ('simulacao_isolada','preparado_rede_bloqueada','sandbox_configurado',
                    'producao_configurada','configuracao_incoerente','conta_suspensa'));
ALTER TABLE public.asaas_accounts DROP CONSTRAINT IF EXISTS asaas_accounts_estado_canonico_ck;
ALTER TABLE public.asaas_accounts ADD CONSTRAINT asaas_accounts_estado_canonico_ck CHECK (
  (state='preparada' AND is_active=false AND modo_execucao='conectado' AND ambiente_provedor=environment
    AND config_status='preparado_rede_bloqueada') OR
  (state='simulada' AND is_active=true AND modo_execucao='simulado' AND ambiente_provedor IS NULL
    AND environment='sandbox' AND secret_ref IS NULL AND config_status='simulacao_isolada') OR
  (state='sandbox_conectada' AND is_active=true AND modo_execucao='conectado' AND environment='sandbox'
    AND ambiente_provedor='sandbox' AND secret_ref LIKE 'ASAAS_SANDBOX_%'
    AND config_status='sandbox_configurado') OR
  (state='producao_conectada' AND is_active=false AND modo_execucao='conectado' AND environment='producao'
    AND ambiente_provedor='producao' AND secret_ref LIKE 'ASAAS_PRODUCAO_%'
    AND config_status='producao_configurada') OR
  (state='suspensa' AND is_active=false AND config_status='conta_suspensa'));

CREATE OR REPLACE FUNCTION public.asaas_account_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.is_active:=NEW.state IN('simulada','sandbox_conectada');
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
  IF NEW.state='producao_conectada' OR (NEW.environment='producao' AND NEW.is_active) THEN
    RAISE EXCEPTION 'Produção permanece impossível de ativar nesta preparação.';
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
DROP TRIGGER IF EXISTS asaas_account_guard ON public.asaas_accounts;
CREATE TRIGGER asaas_account_guard BEFORE INSERT OR UPDATE ON public.asaas_accounts
 FOR EACH ROW EXECUTE FUNCTION public.asaas_account_guard();

CREATE OR REPLACE FUNCTION public.asaas_account_configurar(_account uuid,_state text,_secret_ref text DEFAULT NULL,
  _webhook_secret_ref text DEFAULT NULL,_external_account_id text DEFAULT NULL,_invoice_host_confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.settings.manage') THEN
    RAISE EXCEPTION 'Sem permissão para configurar a conta.';
  END IF;
  SELECT * INTO a FROM public.asaas_accounts WHERE id=_account FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Conta inexistente.'; END IF;
  IF _state NOT IN ('preparada','simulada','sandbox_conectada','suspensa') THEN
    RAISE EXCEPTION 'Estado não habilitado nesta preparação.';
  END IF;
  PERFORM set_config('lardann.asaas_account_config','on',true);
  UPDATE public.asaas_accounts SET
    state=_state,
    is_active=_state IN ('simulada','sandbox_conectada'),
    modo_execucao=CASE WHEN _state='simulada' THEN 'simulado' ELSE 'conectado' END,
    ambiente_provedor=CASE WHEN _state='simulada' THEN NULL ELSE environment END,
    secret_ref=CASE WHEN _state='sandbox_conectada' THEN _secret_ref ELSE NULL END,
    webhook_secret_ref=CASE WHEN _state='sandbox_conectada' THEN _webhook_secret_ref ELSE NULL END,
    external_account_id=coalesce(_external_account_id,external_account_id),
    invoice_host_confirmed=CASE WHEN _state='sandbox_conectada' THEN _invoice_host_confirmed ELSE false END,
    config_status=CASE _state WHEN 'simulada' THEN 'simulacao_isolada'
      WHEN 'sandbox_conectada' THEN 'sandbox_configurado'
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

-- Resolve configuração real; segredo é apenas referência e a rotina é interna.
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
  IF a.state='producao_conectada' THEN RAISE EXCEPTION 'Produção bloqueada nesta preparação.'; END IF;
  RETURN jsonb_build_object('account_id',a.id,'state',a.state,'modo',a.modo_execucao,
    'ambiente',a.ambiente_provedor,'secret_ref',a.secret_ref,'webhook_secret_ref',a.webhook_secret_ref,
    'external_account_id',a.external_account_id,'invoice_host_confirmed',a.invoice_host_confirmed,
    'operacao',_operacao);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_config(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_config(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_config_intencao(_intent uuid,_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a uuid;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
 SELECT account_id INTO a FROM public.asaas_charge_intents WHERE id=_intent;
 IF a IS NULL THEN RAISE EXCEPTION 'Intenção inexistente.'; END IF;
 RETURN public.asaas_exec_config(a,'cobranca'); END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_config_intencao(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_config_intencao(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_config_cobranca(_charge uuid,_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a uuid;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');
 SELECT account_id INTO a FROM public.asaas_charges WHERE id=_charge;
 IF a IS NULL THEN RAISE EXCEPTION 'Cobrança inexistente.'; END IF;
 RETURN public.asaas_exec_config(a,'link'); END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_config_cobranca(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_config_cobranca(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_config_lote(_run uuid,_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE a uuid;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.import.run');
 SELECT account_id INTO a FROM public.asaas_import_runs WHERE id=_run;
 IF a IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
 RETURN public.asaas_exec_config(a,'importacao'); END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_config_lote(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_config_lote(uuid,uuid) TO service_role;

-- Cursor bruto e assinatura da última página para repetição idempotente.
ALTER TABLE public.asaas_import_runs
 ADD COLUMN IF NOT EXISTS last_page_offset integer,
 ADD COLUMN IF NOT EXISTS last_page_next_offset integer,
 ADD COLUMN IF NOT EXISTS last_page_raw_count integer,
 ADD COLUMN IF NOT EXISTS last_page_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS asaas_import_run_aberto_uidx
 ON public.asaas_import_runs(account_id,kind,coalesce(window_start,'-infinity'::date),coalesce(window_end,'infinity'::date))
 WHERE status IN('preparada','em_andamento','pausada');

CREATE OR REPLACE FUNCTION public.asaas_fatura_url_valida(_account uuid,_external_id text,_url text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
 SELECT coalesce((SELECT CASE
  WHEN _url IS NULL OR _external_id IS NULL THEN false
  WHEN a.state='simulada' THEN _external_id~'^sim_[A-Za-z0-9_-]{1,160}$' AND _url='/financeiro/simulacao/'||_external_id
  WHEN a.state='sandbox_conectada' AND a.invoice_host_confirmed THEN _url~'^https://sandbox\.asaas\.com/i/[A-Za-z0-9]{6,64}$'
  ELSE false END FROM public.asaas_accounts a WHERE a.id=_account),false)
$fn$;

CREATE TABLE IF NOT EXISTS public.asaas_import_pages(
 run_id uuid NOT NULL REFERENCES public.asaas_import_runs(id) ON DELETE CASCADE,
 requested_offset integer NOT NULL, requested_limit integer NOT NULL, raw_count integer NOT NULL,
 next_offset integer NOT NULL, kept_count integer NOT NULL, has_more boolean NOT NULL,
 page_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(run_id,requested_offset));
REVOKE ALL ON public.asaas_import_pages FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.asaas_import_pages TO service_role;

-- A conta da cobrança nasce da empresa do título, nunca de escolha do navegador.
CREATE OR REPLACE FUNCTION public.asaas_cobranca_preparar(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE conta record;i record;t record;cliente record;existente record;viva record;
 v_saldo bigint;v_hash text;v_ref text;v_key text;v_venc date;v_forma text;v_id uuid;v_party uuid;n integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para preparar cobrança.'; END IF;
 SELECT * INTO i FROM public.financial_installments WHERE id=(_payload->>'installment_id')::uuid FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Parcela inexistente.'; END IF;
 SELECT * INTO t FROM public.financial_titles WHERE id=i.title_id;
 IF t.direction<>'receivable' OR t.status<>'ativo' OR t.approval_status='pendente' THEN RAISE EXCEPTION 'Título não está apto à cobrança.'; END IF;
 v_saldo:=public.fin_installment_saldo(i.id); IF coalesce(v_saldo,0)<=0 THEN RAISE EXCEPTION 'Parcela sem saldo devido.'; END IF;
 SELECT count(*) INTO n FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada') AND is_active;
 IF n<>1 THEN RAISE EXCEPTION 'A empresa do título deve possuir exatamente uma conta Asaas executável.'; END IF;
 SELECT * INTO conta FROM public.asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada') AND is_active;
 v_party:=coalesce(t.pagador_party_id,t.party_id);
 SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF n>1 THEN RAISE EXCEPTION 'Mais de um cliente Asaas vinculado: defina o canônico antes de cobrar.'; END IF;
 SELECT * INTO cliente FROM public.asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado';
 IF cliente.id IS NULL AND coalesce((_payload->>'criar_cliente')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'Devedor sem cliente externo vinculado.'; END IF;
 SELECT * INTO existente FROM public.asaas_charges WHERE installment_id=i.id AND account_id=conta.id
  AND coalesce(external_status,'') NOT IN('DELETED','REFUNDED','CANCELED') LIMIT 1;
 IF existente.id IS NOT NULL THEN RETURN jsonb_build_object('reaproveitada',true,'charge_id',existente.id,'account_id',conta.id,
  'external_id',existente.external_id,'invoice_url',existente.invoice_url,'aviso','Cobrança ativa reaproveitada.'); END IF;
 v_venc:=coalesce(nullif(_payload->>'due_date','')::date,i.vencimento);IF v_venc<current_date THEN v_venc:=current_date;END IF;
 v_forma:=coalesce(nullif(_payload->>'billing_type',''),'UNDEFINED');v_ref:='lardan:installment:'||i.id;
 v_key:=coalesce(nullif(_payload->>'idempotency_key',''),v_ref||':'||v_saldo||':'||v_venc||':'||(SELECT count(*) FROM public.asaas_charge_intents x WHERE x.installment_id=i.id AND x.state IN('rejeitada','cancelada')));
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 v_hash:=public.fin_fingerprint(jsonb_build_object('account',conta.id,'installment',i.id,'party',v_party,'valor_cents',v_saldo,'due_date',v_venc,'billing_type',v_forma));
 SELECT * INTO existente FROM public.asaas_charge_intents WHERE idempotency_key=v_key;
 IF existente.id IS NOT NULL THEN
  IF existente.content_hash<>v_hash THEN RAISE EXCEPTION 'Colisão de chave: esta chave já foi usada com outro conteúdo.' USING errcode='23505';END IF;
  RETURN jsonb_build_object('id',existente.id,'account_id',existente.account_id,'repetida',true,'state',existente.state,'invoice_url',existente.invoice_url,'external_id',existente.external_id,'internal_reference',existente.internal_reference);
 END IF;
 SELECT * INTO viva FROM public.asaas_charge_intents WHERE installment_id=i.id AND state IN('preparada','processando','criada','desconhecida','conciliacao') LIMIT 1;
 IF viva.id IS NOT NULL THEN RETURN jsonb_build_object('id',viva.id,'account_id',viva.account_id,'repetida',true,'state',viva.state,'invoice_url',viva.invoice_url,'external_id',viva.external_id,'internal_reference',viva.internal_reference);END IF;
 PERFORM set_config('lardann.asaas_intent','on',true);
 INSERT INTO public.asaas_charge_intents(account_id,title_id,installment_id,party_id,customer_external_id,criar_cliente,value_cents,due_date,billing_type,internal_reference,idempotency_key,content_hash,simulado,created_by)
 VALUES(conta.id,t.id,i.id,v_party,cliente.external_id,cliente.id IS NULL,v_saldo,v_venc,v_forma,v_ref||':'||left(md5(v_key),8),v_key,v_hash,conta.modo_execucao='simulado',auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id) VALUES(v_id,NULL,'preparada',jsonb_build_object('valor_cents',v_saldo),auth.uid());
 PERFORM set_config('lardann.asaas_intent','off',true);
 RETURN jsonb_build_object('id',v_id,'account_id',conta.id,'state','preparada','internal_reference',v_ref||':'||left(md5(v_key),8));
END $fn$;

CREATE OR REPLACE FUNCTION public.asaas_import_pagina(_run uuid,_offset integer,_limit integer,
 _raw_count integer,_next_offset integer,_itens jsonb,_has_more boolean,_clientes jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE r record;e jsonb;novos integer:=0;repetidos integer:=0;n integer;h text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'finance.import.run') THEN RAISE EXCEPTION 'Sem permissão para importar recebíveis.'; END IF;
 IF _offset<0 OR _limit<1 OR _limit>100 OR _raw_count<0 OR _raw_count>_limit OR _next_offset<>_offset+_raw_count THEN
   RAISE EXCEPTION 'Metadados de página incompatíveis.';
 END IF;
 IF _has_more AND _raw_count=0 THEN RAISE EXCEPTION 'Provedor indicou continuação sem consumir posição.'; END IF;
 SELECT * INTO r FROM public.asaas_import_runs WHERE id=_run FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
 h:=encode(digest(concat_ws('|',_offset,_limit,_raw_count,_next_offset,_has_more,coalesce(_itens,'[]'::jsonb)::text),'sha256'),'hex');
 IF _offset<>r.offset_atual THEN
   IF EXISTS(SELECT 1 FROM public.asaas_import_pages WHERE run_id=_run AND requested_offset=_offset
      AND requested_limit=_limit AND raw_count=_raw_count AND next_offset=_next_offset AND page_hash=h) THEN
     RETURN jsonb_build_object('run_id',_run,'novos',0,'repetidos',jsonb_array_length(coalesce(_itens,'[]'::jsonb)),
       'offset',r.offset_atual,'has_more',r.has_more,'pagina_repetida',true);
   END IF;
   RAISE EXCEPTION 'Página fora de ordem: esperado %, recebido %.',r.offset_atual,_offset;
 END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_clientes,'[]'::jsonb)) LOOP
  INSERT INTO public.asaas_import_stage(run_id,account_id,tipo,external_id,payload)
  VALUES(_run,r.account_id,'cliente',e->>'id',e) ON CONFLICT(run_id,tipo,external_id) DO NOTHING;
 END LOOP;
 FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) LOOP
  IF coalesce(e->>'id','')='' THEN RAISE EXCEPTION 'Cobrança sem identificador externo.'; END IF;
  INSERT INTO public.asaas_import_stage(run_id,account_id,tipo,external_id,payload)
  VALUES(_run,r.account_id,'cobranca',e->>'id',e) ON CONFLICT(run_id,tipo,external_id) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; IF n=1 THEN novos:=novos+1; ELSE repetidos:=repetidos+1; END IF;
 END LOOP;
 PERFORM set_config('lardann.asaas_import','on',true);
 INSERT INTO public.asaas_import_pages(run_id,requested_offset,requested_limit,raw_count,next_offset,kept_count,has_more,page_hash)
 VALUES(_run,_offset,_limit,_raw_count,_next_offset,jsonb_array_length(coalesce(_itens,'[]'::jsonb)),_has_more,h);
 UPDATE public.asaas_import_runs SET offset_atual=_next_offset,has_more=_has_more,page=page+1,
  status=CASE WHEN _has_more THEN 'em_andamento' ELSE 'pausada' END,
  last_page_offset=_offset,last_page_next_offset=_next_offset,last_page_raw_count=_raw_count,last_page_hash=h WHERE id=_run;
 PERFORM set_config('lardann.asaas_import','off',true);
 RETURN jsonb_build_object('run_id',_run,'novos',novos,'repetidos',repetidos,'offset',_next_offset,
  'has_more',_has_more,'quantidade_bruta',_raw_count,'quantidade_mantida',jsonb_array_length(coalesce(_itens,'[]'::jsonb)));
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_import_pagina(uuid,integer,integer,integer,integer,jsonb,boolean,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asaas_import_pagina(uuid,integer,integer,integer,integer,jsonb,boolean,jsonb) TO authenticated;
DROP FUNCTION IF EXISTS public.asaas_import_pagina(uuid,integer,jsonb,boolean,jsonb);

-- Coordenação distribuída da criação de cliente.
CREATE TABLE IF NOT EXISTS public.asaas_customer_leases(
 account_id uuid NOT NULL REFERENCES public.asaas_accounts(id) ON DELETE CASCADE,
 party_id uuid NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
 worker text NOT NULL, attempt integer NOT NULL DEFAULT 1, lease_until timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'consultar' CHECK(state IN('consultar','criar','desconhecida','concluida','revisao')),
 last_error text, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,party_id));
GRANT ALL ON public.asaas_customer_leases TO service_role;
REVOKE ALL ON public.asaas_customer_leases FROM PUBLIC,anon,authenticated;
ALTER TABLE public.asaas_customer_leases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.asaas_exec_cliente_reservar(_intent uuid,_worker text,_tentativa integer,_actor uuid,_lease integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;cu record;l record;n integer;
BEGIN
 PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage'); it:=public.asaas_exec_posse(_intent,_worker,_tentativa);
 SELECT count(*) INTO n FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id AND match_status='vinculado';
 IF n>1 THEN RETURN jsonb_build_object('reservada',false,'revisao',true,'motivo','Mais de um cliente vinculado; escolha canônica obrigatória.'); END IF;
 SELECT * INTO cu FROM public.asaas_customers WHERE account_id=it.account_id AND party_id=it.party_id AND match_status='vinculado';
 IF cu.id IS NOT NULL THEN RETURN jsonb_build_object('reservada',false,'external_id',cu.external_id,'existente',true); END IF;
 INSERT INTO public.asaas_customer_leases(account_id,party_id,worker,lease_until,state)
 VALUES(it.account_id,it.party_id,_worker,now()+make_interval(secs=>least(greatest(_lease,1),900)),'consultar')
 ON CONFLICT(account_id,party_id) DO UPDATE SET worker=excluded.worker,attempt=asaas_customer_leases.attempt+1,
  lease_until=excluded.lease_until,state=CASE WHEN asaas_customer_leases.state='desconhecida' THEN 'desconhecida' ELSE 'consultar' END,updated_at=now()
 WHERE asaas_customer_leases.lease_until<now() OR asaas_customer_leases.worker=excluded.worker
 RETURNING * INTO l;
 RETURN jsonb_build_object('reservada',l.worker=_worker,'estado',l.state,'tentativa',l.attempt,'lease_until',l.lease_until);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente_reservar(uuid,text,integer,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_cliente_estado(_intent uuid,_worker text,_tentativa integer,_actor uuid,_state text,_erro text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');it:=public.asaas_exec_posse(_intent,_worker,_tentativa);
 IF _state NOT IN('criar','desconhecida','concluida','revisao') THEN RAISE EXCEPTION 'Estado de cliente inválido.'; END IF;
 UPDATE public.asaas_customer_leases SET state=_state,last_error=left(_erro,500),
  lease_until=CASE WHEN _state IN('concluida','revisao') THEN now() ELSE lease_until END,updated_at=now()
 WHERE account_id=it.account_id AND party_id=it.party_id AND worker=_worker;
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_cliente_estado(uuid,text,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_cliente_estado(uuid,text,integer,uuid,text,text) TO service_role;

ALTER TABLE public.asaas_charge_intents
 ADD COLUMN IF NOT EXISTS failure_class text,
 ADD COLUMN IF NOT EXISTS failure_codes text[],
 ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE OR REPLACE FUNCTION public.asaas_exec_adiar(_intent uuid,_worker text,_tentativa integer,_actor uuid,
 _classe text,_codigos text[],_repetir_em integer,_erro text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;prazo timestamptz;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');it:=public.asaas_exec_posse(_intent,_worker,_tentativa);
 IF _classe NOT IN('credencial','limite','consulta_indisponivel') THEN RAISE EXCEPTION 'Classe recuperável inválida.'; END IF;
 prazo:=now()+make_interval(secs=>least(greatest(coalesce(_repetir_em,300),1),86400));
 PERFORM set_config('lardann.asaas_intent','on',true);
 UPDATE public.asaas_charge_intents SET state=CASE WHEN _classe='consulta_indisponivel' THEN 'desconhecida' ELSE state END,
  failure_class=_classe,failure_codes=_codigos,next_attempt_at=prazo,last_error=left(_erro,500),lease_until=NULL WHERE id=_intent;
 PERFORM set_config('lardann.asaas_intent','off',true);
 RETURN jsonb_build_object('id',_intent,'state',(SELECT state FROM public.asaas_charge_intents WHERE id=_intent),
  'failure_class',_classe,'next_attempt_at',prazo);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_adiar(uuid,text,integer,uuid,text,text[],integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_adiar(uuid,text,integer,uuid,text,text[],integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.asaas_exec_revisao(_intent uuid,_worker text,_tentativa integer,_actor uuid,_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $fn$
DECLARE it public.asaas_charge_intents;
BEGIN PERFORM public.asaas_exec_exigir(_actor,'finance.receivable.manage');it:=public.asaas_exec_posse(_intent,_worker,_tentativa);
 PERFORM set_config('lardann.asaas_intent','on',true);
 UPDATE public.asaas_charge_intents SET state='conciliacao',failure_class='referencia_ambigua',
  last_error=left(_motivo,500),lease_until=NULL,next_attempt_at=NULL WHERE id=_intent;
 PERFORM set_config('lardann.asaas_intent','off',true);
 INSERT INTO public.asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id)
 VALUES(_intent,it.state,'conciliacao',jsonb_build_object('motivo','referencia_ambigua'),_actor);
 RETURN jsonb_build_object('id',_intent,'state','conciliacao','failure_class','referencia_ambigua');
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_exec_revisao(uuid,text,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_exec_revisao(uuid,text,integer,uuid,text) TO service_role;

-- Estado público sanitizado por conta.
CREATE OR REPLACE FUNCTION public.asaas_receber_contas()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='public' AS $fn$
BEGIN IF NOT public.has_capability(auth.uid(),'finance.receivable.view') THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',label,'estado',state,
  'situacao',config_status,'modo',modo_execucao,'ambiente',ambiente_provedor,'empresa',owner_entity_id,
  'executavel',state IN('simulada','sandbox_conectada') AND is_active) ORDER BY label,id) FROM public.asaas_accounts),'[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.asaas_receber_contas() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asaas_receber_contas() TO authenticated;

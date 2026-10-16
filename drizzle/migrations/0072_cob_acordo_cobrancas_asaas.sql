
ALTER TABLE public.asaas_charge_intents ADD COLUMN IF NOT EXISTS acordo_simulacao_id uuid REFERENCES public.cob_simulacoes(id), ADD COLUMN IF NOT EXISTS acordo_parcela integer;
DROP INDEX IF EXISTS public.asaas_charge_intents_viva_uidx;
CREATE UNIQUE INDEX asaas_charge_intents_viva_uidx ON public.asaas_charge_intents (installment_id)
  WHERE state = ANY (ARRAY['preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao']) AND acordo_simulacao_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS asaas_charge_intents_acordo_viva_uidx ON public.asaas_charge_intents (acordo_simulacao_id, acordo_parcela)
  WHERE acordo_simulacao_id IS NOT NULL AND state = ANY (ARRAY['preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao']);

-- resultado do executor: parcela do acordo tem valor próprio (não é o saldo da parcela âncora)
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.asaas_exec_resultado'::regproc);
  IF position('IF v_saldo IS DISTINCT FROM it.value_cents THEN' in d) = 0 THEN RAISE EXCEPTION 'trecho não encontrado em asaas_exec_resultado'; END IF;
  d := replace(d, 'IF v_saldo IS DISTINCT FROM it.value_cents THEN', 'IF it.acordo_simulacao_id IS NULL AND v_saldo IS DISTINCT FROM it.value_cents THEN');
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public.cob_acordo_cobrancas_preparar(_sim uuid, _forma text, _incluir_entrada boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s cob_simulacoes; ancora uuid; t record; conta record; cliente record; n int; x jsonb; itens jsonb := '[]'; v_id uuid; v_key text; v_venc date;
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; vivas text; ex record; v_party uuid; res jsonb := '[]';
BEGIN
  IF NOT public.cob_pode(auth.uid()) OR NOT public.asaas_ator_pode(auth.uid(),'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem permissão para gerar cobrança no Asaas.'; END IF;
  IF _forma NOT IN ('PIX','BOLETO','CREDIT_CARD','UNDEFINED') THEN RAISE EXCEPTION 'Forma inválida.'; END IF;
  SELECT * INTO s FROM cob_simulacoes WHERE id=_sim FOR UPDATE;
  IF s.id IS NULL OR s.status NOT IN ('simulada','aguardando_entrada','efetivada') THEN RAISE EXCEPTION 'Acordo não está ativo.'; END IF;
  SELECT i.id INTO ancora FROM financial_installments i WHERE i.id = ANY(s.installment_ids) AND public.fin_installment_saldo(i.id) > 0 ORDER BY i.vencimento, i.numero LIMIT 1;
  IF ancora IS NULL THEN RAISE EXCEPTION 'As dívidas deste acordo já estão quitadas.'; END IF;
  SELECT string_agg(coalesce(c.external_id,'?')||' ('||to_char(c.value_cents/100.0,'FM999G990D00')||')',', ') INTO vivas FROM asaas_charges c
   WHERE c.installment_id = ANY(s.installment_ids) AND c.external_status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS')
     AND NOT EXISTS (SELECT 1 FROM asaas_charge_intents ai WHERE ai.charge_id=c.id AND ai.acordo_simulacao_id IS NOT NULL);
  IF vivas IS NOT NULL THEN RAISE EXCEPTION 'Estas dívidas já têm cobrança aberta no Asaas: %. Cancele no Asaas antes, para a cliente não pagar duas vezes.', vivas; END IF;
  SELECT tt.* INTO t FROM financial_titles tt JOIN financial_installments i ON i.title_id=tt.id WHERE i.id=ancora;
  SELECT count(*) INTO n FROM asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada','producao_conectada') AND is_active;
  IF n<>1 THEN RAISE EXCEPTION 'A empresa da dívida deve possuir exatamente uma conta Asaas executável.'; END IF;
  SELECT * INTO conta FROM asaas_accounts WHERE owner_entity_id=t.business_entity_id AND billing_default AND state IN('simulada','sandbox_conectada','producao_conectada') AND is_active;
  v_party := coalesce(t.pagador_party_id,t.party_id);
  SELECT * INTO cliente FROM asaas_customers WHERE account_id=conta.id AND party_id=v_party AND match_status='vinculado' LIMIT 1;
  IF _incluir_entrada AND s.entrada_cents > 0 THEN itens := itens || jsonb_build_object('n',0,'valor',s.entrada_cents,'data',coalesce(s.entrada_data,hoje)); END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(s.plano) LOOP itens := itens || jsonb_build_object('n',(x->>'numero')::int,'valor',(x->>'valor_cents')::bigint,'data',(x->>'data')::date); END LOOP;
  IF jsonb_array_length(itens)=0 THEN RAISE EXCEPTION 'Acordo sem parcelas para cobrar.'; END IF;
  PERFORM set_config('lardann.asaas_intent','on',true);
  FOR x IN SELECT * FROM jsonb_array_elements(itens) LOOP
    SELECT * INTO ex FROM asaas_charge_intents WHERE acordo_simulacao_id=_sim AND acordo_parcela=(x->>'n')::int
      AND state IN ('preparada','processando','aguardando_retentativa','criada','desconhecida','conciliacao') LIMIT 1;
    IF ex.id IS NOT NULL THEN res := res || jsonb_build_object('parcela',(x->>'n')::int,'intent_id',ex.id,'reaproveitada',true); CONTINUE; END IF;
    v_venc := greatest((x->>'data')::date, hoje);
    v_key := 'acordo:'||_sim||':'||(x->>'n')||':'||(SELECT count(*) FROM asaas_charge_intents WHERE acordo_simulacao_id=_sim AND acordo_parcela=(x->>'n')::int);
    INSERT INTO asaas_charge_intents(account_id,title_id,installment_id,party_id,customer_external_id,criar_cliente,value_cents,due_date,billing_type,
      internal_reference,idempotency_key,content_hash,simulado,created_by,acordo_simulacao_id,acordo_parcela)
    VALUES(conta.id,t.id,ancora,v_party,cliente.external_id,cliente.id IS NULL,(x->>'valor')::bigint,v_venc,_forma,
      'lardan:acordo:'||_sim||':'||(x->>'n')||':'||left(md5(v_key),6),v_key,
      public.fin_fingerprint(jsonb_build_object('acordo',_sim,'parcela',x->>'n','valor',x->>'valor','venc',v_venc,'forma',_forma)),
      conta.modo_execucao='simulado',auth.uid(),_sim,(x->>'n')::int)
    RETURNING id INTO v_id;
    INSERT INTO asaas_charge_intent_events(intent_id,de,para,detalhe,actor_id) VALUES(v_id,NULL,'preparada',jsonb_build_object('acordo',_sim,'parcela',x->>'n'),auth.uid());
    res := res || jsonb_build_object('parcela',(x->>'n')::int,'intent_id',v_id,'reaproveitada',false);
  END LOOP;
  PERFORM set_config('lardann.asaas_intent','off',true);
  INSERT INTO cob_interacoes(party_id,tipo,resultado,observacao,installment_ids,autor_id)
  VALUES(s.party_id,'negociacao','outro','Cobranças do acordo enviadas ao Asaas ('||jsonb_array_length(res)||' parcela(s), '||_forma||')',s.installment_ids,auth.uid());
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(auth.uid(),'cob.acordo_cobrancas_preparadas','cob_simulacoes',_sim::text,jsonb_build_object('forma',_forma,'itens',res));
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.cob_acordo_cobrancas_preparar(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_acordo_cobrancas_preparar(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cob_acordo_cobrancas(_sim uuid)
 RETURNS TABLE(parcela int, intent_id uuid, state text, valor_cents bigint, vencimento date, forma text, invoice_url text, external_status text, erro text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.cob_pode(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão de cobrança'; END IF;
  RETURN QUERY SELECT DISTINCT ON (i.acordo_parcela) i.acordo_parcela, i.id, i.state, i.value_cents, i.due_date, i.billing_type, i.invoice_url, c.external_status, i.last_error
    FROM asaas_charge_intents i LEFT JOIN asaas_charges c ON c.id=i.charge_id
   WHERE i.acordo_simulacao_id=_sim ORDER BY i.acordo_parcela, i.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.cob_acordo_cobrancas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cob_acordo_cobrancas(uuid) TO authenticated;

-- baixa de parcela do acordo: abate as dívidas originais da mais antiga para a mais nova; excedente = juros; desconto só no fim
CREATE OR REPLACE FUNCTION public.cob_acordo_baixa(_charge uuid, _intent uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c asaas_charges; it asaas_charge_intents; s cob_simulacoes; conta uuid; chave text; valor bigint; tarifa bigint; resto bigint; juros bigint := 0;
  aloc jsonb := '[]'; p record; sd bigint; dia date; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; r jsonb; primeira uuid;
  total_partes int; pagas int; residuo bigint; dsc bigint;
BEGIN
  SELECT * INTO c FROM asaas_charges WHERE id=_charge FOR UPDATE;
  SELECT * INTO it FROM asaas_charge_intents WHERE id=_intent;
  SELECT * INTO s FROM cob_simulacoes WHERE id=it.acordo_simulacao_id FOR UPDATE;
  SELECT financial_account_id INTO conta FROM asaas_accounts WHERE id=c.account_id;
  IF conta IS NULL THEN RETURN jsonb_build_object('baixa',false,'motivo','conta_asaas_sem_conta_financeira'); END IF;
  chave := 'asaas:baixa:'||c.account_id||':'||c.external_id;
  IF EXISTS (SELECT 1 FROM financial_settlements WHERE idempotency_key=chave) THEN RETURN jsonb_build_object('baixa',false,'motivo','ja_baixada_pelo_asaas','repetido',true); END IF;
  valor := coalesce(c.received_cents,c.value_cents);
  tarifa := greatest(coalesce(c.fee_cents, CASE WHEN c.net_value_cents IS NOT NULL THEN valor-c.net_value_cents END,0),0);
  IF valor IS NULL OR valor<=0 OR tarifa>=valor THEN RETURN jsonb_build_object('baixa',false,'motivo','valor_invalido'); END IF;
  resto := valor;
  FOR p IN SELECT i.id FROM financial_installments i WHERE i.id=ANY(s.installment_ids) ORDER BY i.vencimento, i.numero LOOP
    EXIT WHEN resto<=0;
    sd := coalesce(public.fin_installment_saldo(p.id),0);
    IF sd<=0 THEN CONTINUE; END IF;
    IF primeira IS NULL THEN primeira := p.id; END IF;
    aloc := aloc || jsonb_build_object('installment_id',p.id,'valor_cents',least(sd,resto));
    resto := resto - least(sd,resto);
  END LOOP;
  IF primeira IS NULL THEN RETURN jsonb_build_object('baixa',false,'motivo','dividas_ja_quitadas','pago_cents',valor); END IF;
  IF resto>0 THEN
    -- excedente sobre o principal = encargos do acordo (juros/multa), lançado na primeira parcela abatida
    juros := resto;
    aloc := (SELECT jsonb_agg(CASE WHEN (e->>'installment_id')::uuid=primeira THEN jsonb_build_object('installment_id',primeira,'valor_cents',(e->>'valor_cents')::bigint+juros) ELSE e END) FROM jsonb_array_elements(aloc) e);
  END IF;
  dia := least(coalesce(c.payment_date,c.confirmed_date,hoje),hoje);
  PERFORM set_config('lardan.baixa_asaas','on',true);
  BEGIN
    r := public.fin_settlement_create_ajustes(jsonb_build_object('direction','receivable','financial_account_id',conta,'data',dia::text,'valor_cents',valor,
      'tarifa_cents',tarifa,'juros_cents',juros,'referencia','Asaas '||c.external_id||' · acordo parcela '||it.acordo_parcela,
      'observacao','Baixa automática: parcela '||it.acordo_parcela||' do acordo confirmada pelo Asaas','idempotency_key',chave,'alocacoes',aloc));
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('lardan.baixa_asaas','off',true);
    RETURN jsonb_build_object('baixa',false,'motivo','motor_recusou','erro',SQLERRM);
  END;
  PERFORM set_config('lardan.baixa_asaas','off',true);
  -- última parcela do acordo paga: aplica o desconto combinado sobre o que sobrou (até o limite do desconto)
  SELECT jsonb_array_length(s.plano) + CASE WHEN EXISTS(SELECT 1 FROM asaas_charge_intents WHERE acordo_simulacao_id=s.id AND acordo_parcela=0) THEN 1 ELSE 0 END INTO total_partes;
  SELECT count(DISTINCT i.acordo_parcela) INTO pagas FROM asaas_charge_intents i JOIN asaas_charges ch ON ch.id=i.charge_id
   WHERE i.acordo_simulacao_id=s.id AND (ch.external_status IN ('RECEIVED','CONFIRMED') OR ch.id=c.id);
  IF pagas >= total_partes AND s.desconto_cents > 0 THEN
    dsc := s.desconto_cents;
    FOR p IN SELECT i.id FROM financial_installments i WHERE i.id=ANY(s.installment_ids) ORDER BY i.vencimento DESC LOOP
      EXIT WHEN dsc<=0;
      residuo := coalesce(public.fin_installment_saldo(p.id),0);
      IF residuo<=0 THEN CONTINUE; END IF;
      INSERT INTO financial_adjustments(installment_id,settlement_id,kind,valor_cents,motivo,created_by)
      VALUES(p.id,(r->>'id')::uuid,'desconto',least(residuo,dsc),'Desconto do acordo de cobrança '||left(s.id::text,8),NULL);
      PERFORM public.fin_installment_refresh(p.id);
      dsc := dsc - least(residuo,dsc);
    END LOOP;
  END IF;
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload) VALUES(NULL,'cob.acordo_baixa_asaas','cob_simulacoes',s.id::text,
    jsonb_build_object('charge',c.external_id,'parcela_acordo',it.acordo_parcela,'valor',valor,'tarifa',tarifa,'juros',juros,'alocacoes',aloc,'settlement',r->>'id'));
  RETURN jsonb_build_object('baixa',true,'settlement_id',r->>'id','valor_cents',valor,'tarifa_cents',tarifa,'juros_cents',juros,'acordo',s.id);
END $$;
REVOKE ALL ON FUNCTION public.cob_acordo_baixa(uuid,uuid) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE d text; alvo text := $a$    RETURN jsonb_build_object('baixa', false, 'motivo', 'nao_recebida');
  END IF;$a$; BEGIN
  d := pg_get_functiondef('public.asaas_baixa_automatica'::regproc);
  IF position(alvo in d) = 0 THEN RAISE EXCEPTION 'trecho não encontrado em asaas_baixa_automatica'; END IF;
  d := replace(d, alvo, alvo || $b$
  -- cobrança de parcela de acordo: rotina própria que abate as dívidas originais
  DECLARE ai uuid; BEGIN
    SELECT id INTO ai FROM public.asaas_charge_intents WHERE acordo_simulacao_id IS NOT NULL
      AND (charge_id = c.id OR (account_id = c.account_id AND external_id = c.external_id)) LIMIT 1;
    IF ai IS NOT NULL THEN RETURN public.cob_acordo_baixa(c.id, ai); END IF;
  END;$b$);
  EXECUTE d;
END $$;

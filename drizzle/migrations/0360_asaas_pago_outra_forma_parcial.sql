-- 0360 (Diego, 20/11/2026) — "Pago por outra forma" na gaveta da cobrança Asaas (A Receber), total ou parcial.
-- Casos de origem: Natalia Alessandra Pedroso (total) e Clara Cristina Neves da Silva (parcial), cobranças do SmallData sem título no Lardan.
-- 1) Cobrança sem título: cria o título oficial (mesmo caminho do 0305 "novo": fin_title_create + asaas_vincular_interno),
--    só quando a cliente não tem dívida antiga do SmallData em aberto e não é cliente judicial (senão seria dívida em dobro).
-- 2) Baixa oficial do valor recebido; parcial deixa o saldo no título para a Larissa lançar a nova cobrança.
-- 3) Cancelamento no Asaas registrado sem abrir o alerta "excluída no Asaas" e fechando a intenção viva da cobrança.

CREATE OR REPLACE FUNCTION public.asaas_pago_outra_forma(_charge uuid, _conta uuid, _data date, _valor bigint, _forma text, _comprovante text, _obs text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; parcela uuid; saldo bigint; r jsonb; v_id uuid; chave text; hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_tit uuid; v_conta_prov uuid; v_emp uuid; v_ref date; v_rem text; v_desc text; v_antiga bigint; v_criou boolean := false; v_resta bigint;
BEGIN
  IF NOT public.asaas_ator_pode(auth.uid(), 'finance.receivable.manage') THEN RAISE EXCEPTION 'Sem acesso ao financeiro para dar baixa.'; END IF;
  IF _forma NOT IN ('pix','dinheiro','transferencia','cartao_maquininha','outro') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  IF _data IS NULL OR _data > hoje THEN RAISE EXCEPTION 'Informe a data do pagamento (não pode ser futura).'; END IF;
  IF _valor IS NULL OR _valor <= 0 THEN RAISE EXCEPTION 'Informe o valor recebido.'; END IF;
  IF _comprovante IS NOT NULL AND _comprovante NOT LIKE 'asaas-outra-forma/' || _charge || '/%' THEN RAISE EXCEPTION 'Comprovante inválido.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM financial_accounts WHERE id=_conta AND is_active AND excluida_em IS NULL) THEN RAISE EXCEPTION 'Escolha a conta onde o dinheiro entrou.'; END IF;
  SELECT * INTO c FROM asaas_charges WHERE id=_charge FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Cobrança não encontrada.'; END IF;
  IF EXISTS (SELECT 1 FROM asaas_baixas_outra_forma WHERE charge_id=_charge) THEN RAISE EXCEPTION 'Esta cobrança já foi marcada como paga por outra forma.'; END IF;
  IF c.external_status NOT IN ('PENDING','OVERDUE') THEN RAISE EXCEPTION 'Só cobranças em aberto ou vencidas podem ser marcadas como pagas por outra forma (situação atual: %).', c.external_status; END IF;
  IF EXISTS (SELECT 1 FROM asaas_charge_intents WHERE acordo_simulacao_id IS NOT NULL AND (charge_id=c.id OR (account_id=c.account_id AND external_id=c.external_id))) THEN
    RAISE EXCEPTION 'Cobrança de acordo: registre o pagamento pelo acordo, não por aqui.'; END IF;
  IF EXISTS (SELECT 1 FROM financial_settlements WHERE idempotency_key = 'asaas:baixa:' || c.account_id || ':' || c.external_id) THEN RAISE EXCEPTION 'Esta cobrança já foi baixada pelo Asaas.'; END IF;
  parcela := c.installment_id;
  IF parcela IS NULL THEN
    SELECT m.installment_id INTO parcela FROM asaas_charge_matches m WHERE m.charge_id=c.id AND m.status='confirmado' AND m.installment_id IS NOT NULL ORDER BY m.decidido_em DESC NULLS LAST LIMIT 1;
  END IF;
  IF parcela IS NULL AND c.title_id IS NULL THEN
    IF c.party_id IS NULL THEN RAISE EXCEPTION 'Cobrança sem cliente identificada: vincule a cliente antes de dar baixa.'; END IF;
    IF EXISTS (SELECT 1 FROM cob_judicial_processos jp WHERE jp.party_id = c.party_id) OR EXISTS (SELECT 1 FROM cob_judicial j WHERE j.party_id = c.party_id) THEN
      RAISE EXCEPTION 'Cliente com cobrança judicial: registre o pagamento pelo Judicial.'; END IF;
    SELECT coalesce(sum(public.fin_installment_saldo(i.id)), 0) INTO v_antiga
      FROM financial_installments i JOIN financial_titles t ON t.id = i.title_id
     WHERE t.party_id = c.party_id AND t.direction = 'receivable' AND t.status = 'ativo' AND t.sistema_origem = 'fiado_historico'
       AND public.fin_installment_saldo(i.id) > 0;
    IF v_antiga > 0 THEN
      RAISE EXCEPTION 'Esta cliente ainda tem dívida antiga do SmallData em aberto (R$ %). Para não cobrar em dobro, o Master aplica antes a troca do SmallData (Integração Asaas) e depois você dá a baixa.',
        to_char(v_antiga/100.0,'FM999G990D00'); END IF;
    SELECT financial_account_id, owner_entity_id INTO v_conta_prov, v_emp FROM asaas_accounts WHERE id = c.account_id;
    v_rem := CASE WHEN c.raw->>'externalReference' ~ '^\d{5}R\d{8}$' THEN ' remessa ' || substr(c.raw->>'externalReference', 7, 6)::int ELSE '' END;
    v_ref := public.asaas_smalldata_data_ref(c.id);
    v_desc := 'Acerto SmallData' || v_rem || ' · cobrança Asaas ' || c.external_id;
    SELECT id INTO v_tit FROM financial_titles WHERE sistema_origem = 'asaas' AND id_externo = 'asaas:' || c.external_id;
    IF v_tit IS NULL THEN
      v_tit := public.fin_title_create(jsonb_build_object(
        'direction','receivable','party_id',c.party_id,'descricao',v_desc,'documento',c.external_id,
        'emissao', coalesce(v_ref, c.due_date)::text,'competencia', coalesce(v_ref, c.due_date)::text,'financial_account_id',v_conta_prov,'business_entity_id',v_emp,
        'valor_cents',c.value_cents,'status','ativo','origem','conciliacao','sistema_origem','asaas','id_externo','asaas:' || c.external_id,
        'observacao','Cobrança do SmallData no Asaas sem título: criado na baixa "pago por outra forma" (0360)',
        'parcelas', jsonb_build_array(jsonb_build_object('vencimento', c.due_date::text, 'valor_cents', c.value_cents))));
      v_criou := true;
    END IF;
    SELECT id INTO parcela FROM financial_installments WHERE title_id = v_tit ORDER BY numero LIMIT 1;
    PERFORM public.asaas_vincular_interno(c.id, v_tit, parcela, 'Pago por outra forma: título criado para a cobrança do SmallData (0360)', auth.uid());
    INSERT INTO asaas_smalldata_substituicoes (lote, party_id, acao, charge_ids, novos_titulos, ligado_installment_id, antigos_titulos,
        antigo_cents, cobertura_cents, data_referencia, detalhe, actor_id)
    VALUES (gen_random_uuid(), c.party_id, 'novo', ARRAY[c.id], ARRAY[v_tit], NULL, '{}', 0, c.value_cents, v_ref,
        jsonb_build_object('origem','pago_outra_forma_0360','criou_titulo',v_criou), auth.uid());
  END IF;
  IF parcela IS NULL THEN RAISE EXCEPTION 'Cobrança sem parcela vinculada: vincule antes de dar baixa.'; END IF;
  saldo := public.fin_installment_saldo(parcela);
  IF coalesce(saldo,0) <= 0 THEN RAISE EXCEPTION 'A parcela já está quitada.'; END IF;
  IF _valor > saldo THEN RAISE EXCEPTION 'Valor maior que o saldo da parcela (R$ %).', to_char(saldo/100.0,'FM999G990D00'); END IF;
  chave := 'asaas:outra_forma:' || c.account_id || ':' || c.external_id;
  r := public.fin_settlement_create_ajustes(jsonb_build_object(
    'direction','receivable','financial_account_id',_conta,'data',_data::text,'valor_cents',_valor,
    'referencia','Pago por outra forma (' || _forma || ') — Asaas ' || c.external_id,
    'observacao', 'Pago por outra forma; cobrança Asaas cancelada para não cobrar de novo' || coalesce(' — ' || nullif(left(_obs,500),''),''),
    'idempotency_key', chave,
    'alocacoes', jsonb_build_array(jsonb_build_object('installment_id',parcela,'valor_cents',_valor))));
  INSERT INTO asaas_baixas_outra_forma(charge_id,installment_id,settlement_id,financial_account_id,valor_cents,data,forma,comprovante_path,observacao,actor_id)
  VALUES (_charge,parcela,(r->>'id')::uuid,_conta,_valor,_data,_forma,_comprovante,nullif(left(_obs,500),''),auth.uid()) RETURNING id INTO v_id;
  v_resta := public.fin_installment_saldo(parcela);
  INSERT INTO audit_logs(actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'asaas.pago_outra_forma', 'asaas_charges', _charge::text,
    jsonb_build_object('baixa',v_id,'settlement',r->>'id','valor',_valor,'forma',_forma,'saldo_restante',v_resta,'criou_titulo',v_criou,'title_id',v_tit));
  RETURN jsonb_build_object('id',v_id,'settlement_id',r->>'id','installment_id',parcela,
    'title_id',(SELECT title_id FROM financial_installments WHERE id=parcela),
    'titulo_numero',(SELECT t.numero FROM financial_installments i JOIN financial_titles t ON t.id=i.title_id WHERE i.id=parcela),
    'saldo_restante_cents',v_resta,'parcial',v_resta > 0,'criou_titulo',v_criou);
END $$;
REVOKE ALL ON FUNCTION public.asaas_pago_outra_forma(uuid,uuid,date,bigint,text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.asaas_pago_outra_forma(uuid,uuid,date,bigint,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.asaas_outra_forma_cancelamento(_id uuid, _ok boolean, _erro text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b record; v_it record;
BEGIN
  SELECT * INTO b FROM asaas_baixas_outra_forma WHERE id=_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Baixa inexistente.'; END IF;
  UPDATE asaas_baixas_outra_forma SET cancel_status = CASE WHEN _ok THEN 'cancelado' ELSE 'falhou' END,
    cancel_erro = CASE WHEN _ok THEN NULL ELSE left(_erro,500) END, cancel_tentativas = cancel_tentativas+1, updated_at=now() WHERE id=_id;
  IF _ok THEN
    PERFORM set_config('lardann.asaas_link','on', true);
    PERFORM set_config('lardann.asaas_saldo','on', true);
    UPDATE asaas_charges SET external_status='DELETED',
           reconcile_note = left('Cancelada no Asaas pela baixa "pago por outra forma" de ' || to_char(b.valor_cents/100.0,'FM999G990D00'), 300)
     WHERE id=b.charge_id AND external_status IN ('PENDING','OVERDUE');
    PERFORM set_config('lardann.asaas_intent','on', true);
    FOR v_it IN SELECT id, state FROM asaas_charge_intents WHERE charge_id = b.charge_id AND state IN ('criada','conciliacao') FOR UPDATE LOOP
      UPDATE asaas_charge_intents SET state = 'cancelada', resolved_at = now(),
             last_error = 'Cobrança cancelada no Asaas pela baixa "pago por outra forma"' WHERE id = v_it.id;
      INSERT INTO asaas_charge_intent_events (intent_id, de, para, detalhe, actor_id)
      VALUES (v_it.id, v_it.state, 'cancelada', jsonb_build_object('motivo', 'pago_outra_forma', 'baixa', b.id), b.actor_id);
    END LOOP;
    PERFORM set_config('lardann.asaas_intent','off', true);
    PERFORM set_config('lardann.asaas_saldo','off', true);
    PERFORM set_config('lardann.asaas_link','off', true);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.asaas_outra_forma_cancelamento(uuid,boolean,text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asaas_outra_forma_cancelamento(uuid,boolean,text) TO service_role;
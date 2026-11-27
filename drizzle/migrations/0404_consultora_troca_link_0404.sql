CREATE OR REPLACE FUNCTION public.consultora_cobranca_troca_preparar(_order uuid, _forma text, _parcelas integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders; cfg consultora_cobranca_config;
  v_vivas uuid[]; v_n int; v_grupo int; v_precisa boolean := false; ex record;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  IF _forma NOT IN ('pix','cartao','depois') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF o.pay_installment_id IS NULL THEN RETURN jsonb_build_object('precisa_trocar',false); END IF;
  IF o.payment_status='pago' OR coalesce(public.fin_installment_saldo(o.pay_installment_id),1)<=0 THEN
    RAISE EXCEPTION 'Esta venda já foi paga. Não dá para gerar outro link.'; END IF;
  IF EXISTS (SELECT 1 FROM asaas_charges WHERE installment_id=o.pay_installment_id AND external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH')) THEN
    RAISE EXCEPTION 'A cliente já pagou parte desta venda. Fale com o financeiro.'; END IF;
  SELECT array_agg(id), count(*) INTO v_vivas, v_n FROM asaas_charges
   WHERE installment_id=o.pay_installment_id AND coalesce(external_status,'') NOT IN ('DELETED','REFUNDED','CANCELED');
  IF o.pay_method IS DISTINCT FROM _forma THEN v_precisa := true;
  ELSIF _forma='cartao' AND v_n>0 THEN
    SELECT * INTO ex FROM asaas_charges WHERE id=v_vivas[1];
    v_grupo := CASE WHEN ex.installment_external_id IS NULL THEN 1 ELSE (SELECT count(*) FROM asaas_charges z WHERE z.account_id=ex.account_id AND z.installment_external_id=ex.installment_external_id AND coalesce(z.external_status,'') NOT IN ('DELETED','REFUNDED','CANCELED')) END;
    v_precisa := v_grupo <> coalesce(_parcelas,1);
  END IF;
  RETURN jsonb_build_object('precisa_trocar',v_precisa,'actor',cfg.ator_user_id,'cobrancas',coalesce(to_jsonb(v_vivas),'[]'::jsonb));
END $function$;
REVOKE ALL ON FUNCTION public.consultora_cobranca_troca_preparar(uuid,text,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_cobranca_troca_preparar(uuid,text,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_cobranca_troca_concluir(_order uuid, _forma text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  IF _forma NOT IN ('pix','cartao','depois') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL OR o.pay_installment_id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM asaas_charges WHERE installment_id=o.pay_installment_id AND coalesce(external_status,'') NOT IN ('DELETED','REFUNDED','CANCELED')) THEN
    RAISE EXCEPTION 'O link anterior ainda está aberto no Asaas. Tente de novo em instantes.'; END IF;
  UPDATE sales_orders SET pay_method=_forma, pay_url=NULL, pay_charge_id=NULL,
    pay_due_date=CASE WHEN _forma='depois' THEN greatest(coalesce(pay_due_date,hoje),hoje) ELSE hoje END WHERE id=o.id;
  INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
  VALUES (o.id,'pagamento.link_trocado',o.status::text,uid,jsonb_build_object('de',o.pay_method,'para',_forma));
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,payload)
  VALUES (uid,'consultora.cobranca.trocar_link','sales_orders',o.id::text,jsonb_build_object('de',o.pay_method,'para',_forma));
  RETURN jsonb_build_object('ok',true);
END $function$;
REVOKE ALL ON FUNCTION public.consultora_cobranca_troca_concluir(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_cobranca_troca_concluir(uuid,text) TO authenticated, service_role;
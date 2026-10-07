CREATE OR REPLACE FUNCTION public.consultora_pagamento_lembrete(_order uuid, _venc date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('cancelado','concluido') THEN RAISE EXCEPTION 'Este pedido já foi encerrado.'; END IF;
  IF o.pay_installment_id IS NOT NULL THEN RAISE EXCEPTION 'Este pedido já tem uma cobrança Lardan gerada.'; END IF;
  IF _venc IS NULL OR _venc < hoje OR _venc > hoje + 90 THEN RAISE EXCEPTION 'Escolha uma data entre hoje e 90 dias.'; END IF;
  UPDATE sales_orders SET pay_method='depois', pay_due_date=_venc, payment_status='pendente',
    status = CASE WHEN status IN ('aguardando_atendimento','em_atendimento') THEN 'aguardando_pagamento' ELSE status END
  WHERE id=o.id;
  INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
  VALUES (o.id,'pagamento.lembrete',o.status::text,uid,jsonb_build_object('vencimento',_venc,'valor_cents',o.subtotal_cents));
  RETURN jsonb_build_object('vencimento',_venc);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pagamento_lembrete(uuid,date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pagamento_lembrete(uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultora_lembretes_vencimento()
RETURNS TABLE(order_id uuid, code text, customer_name text, customer_phone text, valor_cents bigint, vencimento date, dias int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT o.id, o.code, o.customer_name, o.customer_phone, o.subtotal_cents, o.pay_due_date,
         (o.pay_due_date - (now() at time zone 'America/Sao_Paulo')::date)::int
  FROM sales_orders o
  WHERE o.consultora_party_id = public.my_party_id() AND auth.uid() IS NOT NULL
    AND o.pay_method='depois' AND o.pay_paid_at IS NULL AND o.payment_status <> 'pago'
    AND o.status NOT IN ('cancelado','concluido')
    AND o.pay_due_date <= (now() at time zone 'America/Sao_Paulo')::date + 1
  ORDER BY o.pay_due_date;
$$;
REVOKE ALL ON FUNCTION public.consultora_lembretes_vencimento() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consultora_lembretes_vencimento() TO authenticated;
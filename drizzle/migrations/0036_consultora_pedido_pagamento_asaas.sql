ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS pay_method text CHECK (pay_method IN ('pix','cartao','depois')),
  ADD COLUMN IF NOT EXISTS pay_doc_masked text,
  ADD COLUMN IF NOT EXISTS pay_due_date date,
  ADD COLUMN IF NOT EXISTS pay_party_id uuid REFERENCES public.parties(id),
  ADD COLUMN IF NOT EXISTS pay_title_id uuid REFERENCES public.financial_titles(id),
  ADD COLUMN IF NOT EXISTS pay_installment_id uuid REFERENCES public.financial_installments(id),
  ADD COLUMN IF NOT EXISTS pay_charge_id uuid,
  ADD COLUMN IF NOT EXISTS pay_url text,
  ADD COLUMN IF NOT EXISTS pay_paid_at timestamptz;
COMMENT ON COLUMN public.sales_orders.pay_method IS 'Cobrança direta da Lardan à cliente (Asaas). Valor pago abate no acerto da maleta da consultora.';
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_pay_installment_uq ON public.sales_orders(pay_installment_id) WHERE pay_installment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.consultora_cobranca_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ator_user_id uuid NOT NULL,
  business_entity_id uuid NOT NULL REFERENCES public.business_entities(id),
  financial_account_id uuid NOT NULL REFERENCES public.financial_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.consultora_cobranca_config TO service_role;
ALTER TABLE public.consultora_cobranca_config ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.consultora_cobranca_config IS 'Assinatura técnica (usuário do financeiro) e conta Lardan usadas nas cobranças Asaas geradas pelas consultoras.';

INSERT INTO public.consultora_cobranca_config(ator_user_id, business_entity_id, financial_account_id)
SELECT u.pix_responsavel_user_id, a.owner_entity_id, a.financial_account_id
FROM public.asaas_accounts a JOIN public.pdv_unidades u ON u.pix_responsavel_user_id IS NOT NULL
WHERE a.is_active AND a.billing_default AND a.financial_account_id IS NOT NULL
LIMIT 1
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.consultora_pagamento_titulo(_order uuid, _forma text, _doc text, _venc date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eu uuid := public.my_party_id(); uid uuid := auth.uid(); o sales_orders; cfg consultora_cobranca_config;
  d text := regexp_replace(coalesce(_doc,''),'\D','','g'); party uuid; tid uuid; inst uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date; venc date; nome_c text;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  IF _forma NOT IN ('pix','cartao','depois') THEN RAISE EXCEPTION 'Forma de pagamento inválida.'; END IF;
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('cancelado','concluido') THEN RAISE EXCEPTION 'Este pedido já foi encerrado.'; END IF;
  IF coalesce(o.subtotal_cents,0) <= 0 THEN RAISE EXCEPTION 'Pedido sem valor.'; END IF;
  SELECT * INTO cfg FROM consultora_cobranca_config WHERE id;
  IF cfg.ator_user_id IS NULL THEN RAISE EXCEPTION 'Cobrança Lardan ainda não configurada. Avise o financeiro.'; END IF;
  IF o.pay_installment_id IS NOT NULL THEN
    IF o.pay_method IS DISTINCT FROM _forma THEN RAISE EXCEPTION 'Este pedido já tem uma cobrança gerada. Use a cobrança existente.'; END IF;
    RETURN jsonb_build_object('installment_id',o.pay_installment_id,'actor',cfg.ator_user_id,'forma',o.pay_method,'vencimento',o.pay_due_date);
  END IF;
  IF length(d) <> 11 OR NOT public.cpf_is_valid(d) THEN RAISE EXCEPTION 'CPF da cliente inválido. Confira os 11 números.'; END IF;
  venc := CASE WHEN _forma='depois' THEN coalesce(_venc, hoje + 7) ELSE hoje END;
  IF venc < hoje OR venc > hoje + 60 THEN RAISE EXCEPTION 'Escolha um vencimento entre hoje e 60 dias.'; END IF;
  SELECT display_name INTO nome_c FROM parties WHERE id=eu;
  SELECT id INTO party FROM parties WHERE doc_digits=d AND is_active ORDER BY created_at LIMIT 1;
  IF party IS NULL THEN
    INSERT INTO parties(kind,display_name,legal_name,doc,doc_digits,status,created_by)
    VALUES ('pessoa', o.customer_name, o.customer_name, d, d, 'ativo', uid) RETURNING id INTO party;
    INSERT INTO party_roles(party_id,role,created_by) VALUES (party,'cliente',uid);
  END IF;
  UPDATE sales_orders SET pay_method=_forma, pay_doc_masked='***.'||substr(d,4,3)||'.'||substr(d,7,3)||'-**', pay_due_date=venc, pay_party_id=party, payment_status='pendente' WHERE id=o.id;
  INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
  VALUES (o.id,'pagamento.cobranca_lardan',o.status::text,uid,jsonb_build_object('forma',_forma,'vencimento',venc,'valor_cents',o.subtotal_cents));
  -- Assinatura técnica do financeiro; a cobrança sai em nome da Lardan.
  PERFORM public.pdv_como(cfg.ator_user_id);
  tid := public.fin_title_create(jsonb_build_object('direction','receivable','business_entity_id',cfg.business_entity_id,'party_id',party,
     'descricao','Pedido consultora '||o.code||' — '||coalesce(nome_c,'consultora'),'documento','PED-'||o.code,'emissao',hoje,'competencia',hoje,
     'valor_cents',o.subtotal_cents,'financial_account_id',cfg.financial_account_id,'origem','consultora','id_externo','pedido:'||o.id,'status','ativo',
     'parcelas',jsonb_build_array(jsonb_build_object('valor_cents',o.subtotal_cents,'vencimento',venc))));
  SELECT id INTO inst FROM financial_installments WHERE title_id=tid ORDER BY numero LIMIT 1;
  UPDATE sales_orders SET pay_title_id=tid, pay_installment_id=inst WHERE id=o.id;
  RETURN jsonb_build_object('installment_id',inst,'actor',cfg.ator_user_id,'forma',_forma,'vencimento',venc);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pagamento_titulo(uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pagamento_titulo(uuid,text,text,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consultora_asaas_preparar(_actor uuid, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(select 1 from consultora_cobranca_config where ator_user_id=_actor) THEN RAISE EXCEPTION 'Assinatura técnica inválida.'; END IF;
  IF NOT EXISTS(select 1 from sales_orders where pay_installment_id=(_payload->>'installment_id')::uuid and payment_status='pendente') THEN RAISE EXCEPTION 'Parcela não pertence a pedido de consultora.'; END IF;
  PERFORM public.pdv_como(_actor);
  RETURN public.asaas_cobranca_preparar(_payload);
END $$;
REVOKE ALL ON FUNCTION public.consultora_asaas_preparar(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_asaas_preparar(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_pagamento_registrar(_order uuid, _charge uuid, _url text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE sales_orders SET pay_charge_id=coalesce(_charge,pay_charge_id), pay_url=coalesce(_url,pay_url) WHERE id=_order AND pay_installment_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.consultora_pagamento_registrar(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_pagamento_registrar(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.consultora_pagamento_situacao(_order uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eu uuid := public.my_party_id(); o sales_orders; saldo bigint;
BEGIN
  SELECT * INTO o FROM sales_orders WHERE id=_order AND consultora_party_id=eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.payment_status='pendente' AND o.pay_installment_id IS NOT NULL THEN
    saldo := public.fin_installment_saldo(o.pay_installment_id);
    IF coalesce(saldo,1) <= 0 THEN
      UPDATE sales_orders SET payment_status='pago', pay_paid_at=now() WHERE id=o.id;
      INSERT INTO sales_order_events(order_id,kind,to_status,actor_user_id,payload)
      VALUES (o.id,'pagamento.recebido_lardan',o.status::text,auth.uid(),jsonb_build_object('valor_cents',o.subtotal_cents,'abate_acerto',true));
      o.payment_status := 'pago';
    END IF;
  END IF;
  RETURN jsonb_build_object('status',o.payment_status,'forma',o.pay_method,'url',o.pay_url,'vencimento',o.pay_due_date,'valor_cents',o.subtotal_cents,'doc',o.pay_doc_masked);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pagamento_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pagamento_situacao(uuid) TO authenticated, service_role;
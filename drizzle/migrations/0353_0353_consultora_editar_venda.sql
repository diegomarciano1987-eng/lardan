-- 0353 (Diego, 19/11/2026): a consultora edita a venda (peças e forma de pagamento) enquanto a cliente não pagou.
-- Paga (Pix/cartão recebido) ou "pagou em dinheiro" = fechada, não edita mais.
-- Se já existia cobrança Lardan ainda não paga, ela é cancelada aqui (o Asaas é cancelado pela rotina oficial de
-- títulos cancelados) e a consultora gera a nova com o valor/forma certos.
CREATE OR REPLACE FUNCTION public.consultora_pedido_editar(_order uuid, _itens jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  eu uuid := public.my_party_id(); uid uuid := auth.uid(); o public.sales_orders;
  item record; preco integer; b public.kit_balances; nome text; ja integer;
  total bigint := 0; contagem integer := 0; pago bigint; pagas integer; antes jsonb; cancelado uuid;
BEGIN
  IF uid IS NULL OR eu IS NULL OR NOT public.has_role(uid,'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  SELECT * INTO o FROM public.sales_orders WHERE id = _order AND consultora_party_id = eu FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('cancelado','concluido') THEN RAISE EXCEPTION 'Este pedido já foi encerrado.'; END IF;
  IF o.payment_status = 'pago' THEN
    RAISE EXCEPTION 'Esta venda já foi paga e está fechada. Para trocar algo, fale com a Lardan.';
  END IF;
  IF o.channel IS DISTINCT FROM 'consultora' THEN RAISE EXCEPTION 'Só vendas feitas no app podem ser editadas.'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('cycle_id', i.cycle_id, 'variant_id', i.variant_id, 'quantidade', i.quantity, 'preco', i.unit_price_cents) ORDER BY i.product_name), '[]')
    INTO antes FROM public.sales_order_items i WHERE i.order_id = o.id;

  -- 1) cobrança Lardan ainda não paga: cancela para liberar a troca (peças ou forma de pagamento)
  IF o.pay_title_id IS NOT NULL THEN
    SELECT coalesce(sum(a.valor_cents),0) INTO pago FROM public.financial_allocations a
      JOIN public.financial_installments i ON i.id = a.installment_id WHERE i.title_id = o.pay_title_id;
    SELECT count(*) INTO pagas FROM public.asaas_charges
     WHERE title_id = o.pay_title_id AND external_status IN ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH');
    IF pago <> 0 OR pagas > 0 THEN
      RAISE EXCEPTION 'A cliente já pagou esta cobrança. A venda está fechada.';
    END IF;
    UPDATE public.financial_titles
       SET status = 'cancelado', cancel_reason = 'Venda editada pela consultora antes do pagamento',
           id_externo = id_externo || ':editada:' || to_char(now(), 'YYYYMMDDHH24MISS'), updated_at = now()
     WHERE id = o.pay_title_id AND status <> 'cancelado';
    INSERT INTO public.financial_title_events (title_id, evento, motivo, actor_id)
    VALUES (o.pay_title_id, 'cancelado', 'Venda editada pela consultora antes do pagamento (pedido ' || o.code || ')', uid);
    cancelado := o.pay_title_id;
  END IF;
  IF o.pay_method IS NOT NULL OR cancelado IS NOT NULL THEN
    UPDATE public.sales_orders
       SET pay_method = NULL, pay_doc_masked = NULL, pay_due_date = NULL, pay_party_id = NULL, pay_title_id = NULL,
           pay_installment_id = NULL, pay_charge_id = NULL, pay_url = NULL, payment_status = 'nao_iniciado',
           status = CASE WHEN status = 'aguardando_pagamento' THEN 'em_atendimento' ELSE status END
     WHERE id = o.id;
  END IF;

  -- 2) peças novas (opcional: sem _itens só troca a forma de pagamento)
  IF _itens IS NOT NULL THEN
    IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN
      RAISE EXCEPTION 'A venda precisa de pelo menos uma peça. Para desistir, cancele o pedido.';
    END IF;
    IF jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Pedido grande demais.'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_itens) e WHERE coalesce((e->>'quantidade')::int,0) NOT BETWEEN 1 AND 99) THEN
      RAISE EXCEPTION 'Quantidade inválida.';
    END IF;
    DELETE FROM public.sales_order_items WHERE order_id = o.id;
    FOR item IN SELECT (e->>'cycle_id')::uuid cyc, (e->>'variant_id')::uuid vid, sum((e->>'quantidade')::int)::int q
                FROM jsonb_array_elements(_itens) e GROUP BY 1,2 ORDER BY 1,2 LOOP
      SELECT pr.name || coalesce(' (' || v.label || ')', '') INTO nome FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
      nome := coalesce(nome, 'uma das peças');
      IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.id = item.cyc AND c.consultora_party_id = eu AND c.status IN ('recebida','operacao')) THEN
        RAISE EXCEPTION 'A peça % não está numa maleta ativa sua.', nome;
      END IF;
      SELECT * INTO b FROM public.kit_balances WHERE cycle_id = item.cyc AND variant_id = item.vid FOR UPDATE;
      ja := public.pedidos_abertos_qtd(item.cyc, item.vid, o.id);
      IF b.id IS NULL OR coalesce(b.qty_available,0) - ja < item.q THEN
        RAISE EXCEPTION 'A peça % já está em outro pedido seu. Restam % unidade(s) livre(s).', nome, greatest(coalesce(b.qty_available,0) - ja, 0);
      END IF;
      preco := public.kit_preco(item.cyc, item.vid);
      INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
      SELECT o.id, item.cyc, item.vid, pr.name, v.label, item.q, preco FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
      total := total + preco::bigint * item.q; contagem := contagem + item.q;
    END LOOP;
    UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem, updated_at = now() WHERE id = o.id;
  END IF;

  INSERT INTO public.sales_order_events (order_id, kind, from_status, to_status, actor_user_id, payload)
  SELECT o.id, 'pedido.editado_consultora', o.status::text, s.status::text, uid,
         jsonb_build_object('antes', antes, 'forma_antes', o.pay_method, 'cobranca_cancelada', cancelado,
                            'pecas_trocadas', _itens IS NOT NULL, 'total_antes', o.subtotal_cents, 'total_depois', s.subtotal_cents)
    FROM public.sales_orders s WHERE s.id = o.id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'consultora.pedido_editado', 'sales_orders', o.id::text,
          jsonb_build_object('consultora', eu, 'cobranca_cancelada', cancelado, 'pecas_trocadas', _itens IS NOT NULL));

  RETURN (SELECT jsonb_build_object('order_id', s.id, 'total_cents', s.subtotal_cents, 'pecas', s.items_count, 'cobranca_cancelada', cancelado IS NOT NULL)
            FROM public.sales_orders s WHERE s.id = o.id);
END $$;
REVOKE ALL ON FUNCTION public.consultora_pedido_editar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultora_pedido_editar(uuid, jsonb) TO authenticated, service_role;
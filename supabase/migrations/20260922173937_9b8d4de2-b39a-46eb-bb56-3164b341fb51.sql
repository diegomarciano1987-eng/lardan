CREATE OR REPLACE FUNCTION public.order_set_status(_order uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.sales_orders; uid uuid := auth.uid(); eu uuid; novo public.sales_order_status;
        it record;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  eu := public.my_party_id();
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR o.consultora_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Sem permissão para atender este pedido.' USING errcode='42501';
  END IF;
  novo := _status::public.sales_order_status;
  IF o.status = novo THEN
    RETURN jsonb_build_object('situacao', o.status, 'repetido', true);
  END IF;
  IF o.status IN ('concluido','cancelado') THEN
    RAISE EXCEPTION 'Este pedido já foi encerrado.';
  END IF;

  IF novo = 'cancelado' THEN
    FOR it IN SELECT * FROM public.sales_order_items WHERE order_id = o.id LOOP
      UPDATE public.kit_balances
         SET qty_reserved = greatest(qty_reserved - it.quantity, 0), updated_at = now()
       WHERE cycle_id = it.cycle_id AND variant_id = it.variant_id;
    END LOOP;
    UPDATE public.sales_orders SET status = novo, cancelled_at = now(), cancel_reason = _note
     WHERE id = o.id;
  ELSIF novo = 'concluido' THEN
    UPDATE public.sales_orders SET status = novo, closed_at = now() WHERE id = o.id;
  ELSE
    UPDATE public.sales_orders SET status = novo WHERE id = o.id;
  END IF;

  INSERT INTO public.sales_order_events (order_id, kind, from_status, to_status, actor_user_id, note)
  VALUES (o.id, 'pedido.situacao', o.status::text, novo::text, uid, _note);

  RETURN jsonb_build_object('situacao', novo);
END $$;
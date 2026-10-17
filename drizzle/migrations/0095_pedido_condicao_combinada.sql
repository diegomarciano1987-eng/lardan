ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS combinado_forma text, ADD COLUMN IF NOT EXISTS combinado_parcelas smallint, ADD COLUMN IF NOT EXISTS combinado_vencimento date;--> statement-breakpoint
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_combinado_ck;--> statement-breakpoint
ALTER TABLE public.sales_orders ADD CONSTRAINT sales_orders_combinado_ck CHECK ((combinado_forma IS NULL OR combinado_forma IN ('pix','credito','debito','dinheiro','a_prazo')) AND (combinado_parcelas IS NULL OR combinado_parcelas BETWEEN 1 AND 12));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consultant_order_combinado_set(_order uuid, _forma text, _parcelas integer, _vencimento date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eu uuid := public.my_party_id(); o public.sales_orders;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO o FROM public.sales_orders WHERE id = _order FOR UPDATE;
  IF o.id IS NULL OR o.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF o.status IN ('concluido','cancelado') THEN RAISE EXCEPTION 'Pedido já encerrado.'; END IF;
  IF _forma IS NOT NULL AND _forma NOT IN ('pix','credito','debito','dinheiro','a_prazo') THEN RAISE EXCEPTION 'Forma inválida.'; END IF;
  IF _parcelas IS NOT NULL AND (_parcelas < 1 OR _parcelas > 12) THEN RAISE EXCEPTION 'Parcelas inválidas.'; END IF;
  UPDATE public.sales_orders SET combinado_forma = _forma,
    combinado_parcelas = CASE WHEN _forma IN ('credito','a_prazo') THEN coalesce(_parcelas,1) END,
    combinado_vencimento = CASE WHEN _forma = 'a_prazo' THEN _vencimento END, updated_at = now()
  WHERE id = _order;
  INSERT INTO public.sales_order_events (order_id, kind, actor_user_id, payload)
  VALUES (_order, 'combinado', auth.uid(), jsonb_build_object('forma',_forma,'parcelas',_parcelas,'vencimento',_vencimento));
  RETURN jsonb_build_object('ok', true);
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultant_order_combinado_set(uuid,text,integer,date) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consultant_order_combinado_set(uuid,text,integer,date) TO authenticated;

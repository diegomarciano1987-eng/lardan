CREATE OR REPLACE FUNCTION public.consultora_clientes_resumo() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
 SELECT cl.id client_id, count(o.id) FILTER (WHERE o.status NOT IN ('cancelado','concluido'))::int pedidos_abertos,
 count(o.id) FILTER (WHERE o.payment_status='pago' AND o.status<>'cancelado')::int compras,
 coalesce(sum(o.subtotal_cents) FILTER (WHERE o.payment_status='pago' AND o.status<>'cancelado'),0) gasto_cents,
 max(coalesce(o.pay_paid_at,o.created_at)) FILTER (WHERE o.payment_status='pago' AND o.status<>'cancelado') ultima_compra
 FROM public.consultant_clients cl LEFT JOIN public.sales_orders o ON o.client_id=cl.id AND o.consultora_party_id=cl.consultora_party_id
 WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora') AND cl.consultora_party_id=public.my_party_id() GROUP BY cl.id
 ) x;
$$;
REVOKE ALL ON FUNCTION public.consultora_clientes_resumo() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_clientes_resumo() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.consultora_cliente_compras(_cliente uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) FROM (
 SELECT o.id,o.code,o.created_at,o.payment_status,o.status,o.subtotal_cents,o.pay_paid_at,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'variant_id',i.variant_id,'nome',p.name,'quantidade',i.quantity,'preco_cents',i.unit_price_cents)),'[]'::jsonb) FROM public.sales_order_items i JOIN public.product_variants v ON v.id=i.variant_id JOIN public.products p ON p.id=v.product_id WHERE i.order_id=o.id) itens
 FROM public.sales_orders o JOIN public.consultant_clients cl ON cl.id=o.client_id
 WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora') AND cl.id=_cliente AND cl.consultora_party_id=public.my_party_id() AND o.consultora_party_id=cl.consultora_party_id ORDER BY o.created_at DESC LIMIT 100
 ) x;
$$;
REVOKE ALL ON FUNCTION public.consultora_cliente_compras(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultora_cliente_compras(uuid) TO authenticated,service_role;
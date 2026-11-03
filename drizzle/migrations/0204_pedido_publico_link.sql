ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_public_token_key ON public.sales_orders(public_token);
COMMENT ON COLUMN public.sales_orders.public_token IS 'Link secreto da página pública do pedido (/pedido/<token>) enviada à cliente pelo WhatsApp.';

CREATE OR REPLACE FUNCTION public.pedido_publico(_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'codigo', o.code,
    'criado_em', o.created_at,
    'cliente', split_part(btrim(o.customer_name), ' ', 1),
    'consultora', (SELECT display_name FROM parties WHERE id = o.consultora_party_id),
    'total_cents', (SELECT coalesce(sum(i.unit_price_cents * i.quantity),0) FROM sales_order_items i WHERE i.order_id = o.id),
    'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'nome', i.product_name, 'variante', i.variant_label, 'quantidade', i.quantity,
        'unitario_cents', i.unit_price_cents,
        'referencia', public.peca_referencia_etiqueta(v.reference_code, p.reference_code),
        'media_id', (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1)
      ) ORDER BY i.created_at), '[]'::jsonb)
      FROM sales_order_items i JOIN product_variants v ON v.id = i.variant_id JOIN products p ON p.id = v.product_id
      WHERE i.order_id = o.id))
  FROM sales_orders o
  WHERE o.public_token = _token AND o.status::text <> 'cancelado'
$$;
REVOKE ALL ON FUNCTION public.pedido_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pedido_publico(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pedido_foto_ok(_token uuid, _media uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM sales_orders o JOIN sales_order_items i ON i.order_id = o.id
    JOIN product_variants v ON v.id = i.variant_id JOIN product_media pm ON pm.product_id = v.product_id
    WHERE o.public_token = _token AND o.status::text <> 'cancelado' AND pm.media_id = _media)
$$;
REVOKE ALL ON FUNCTION public.pedido_foto_ok(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pedido_foto_ok(uuid,uuid) TO service_role;

-- invoker: só devolve o link de pedidos que a pessoa já enxerga pelas regras de acesso
CREATE OR REPLACE FUNCTION public.pedido_token(_order uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT o.public_token FROM sales_orders o WHERE o.id = _order
$$;
REVOKE ALL ON FUNCTION public.pedido_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedido_token(uuid) TO authenticated, service_role;
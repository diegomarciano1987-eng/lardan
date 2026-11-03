CREATE OR REPLACE FUNCTION public.consultora_pecas_buscar(_busca text DEFAULT ''::text, _categoria text DEFAULT ''::text, _banho text DEFAULT ''::text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.produto,x.variante),'[]'::jsonb) FROM (
 SELECT b.cycle_id,b.variant_id,pr.name produto,v.label variante,(b.qty_available-coalesce(ped.ja,0))::int disponivel,public.kit_preco(b.cycle_id, b.variant_id) preco_cents,
 (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id=pr.id ORDER BY pm.position LIMIT 1) media_id,k.code maleta,cat.name categoria,coalesce(pt.name,pr.plating) banho,pr.collection_id,v.barcode,v.sku,pr.internal_code,pr.material,pr.warranty_text
 FROM public.kit_balances b JOIN public.kit_cycles c ON c.id=b.cycle_id JOIN public.kits k ON k.id=c.kit_id JOIN public.product_variants v ON v.id=b.variant_id JOIN public.products pr ON pr.id=v.product_id LEFT JOIN public.categories cat ON cat.id=pr.category_id LEFT JOIN public.plating_types pt ON pt.id=v.plating_type_id
 LEFT JOIN LATERAL (SELECT sum(i.quantity)::int ja FROM public.sales_order_items i JOIN public.sales_orders o ON o.id=i.order_id
   WHERE i.cycle_id=b.cycle_id AND i.variant_id=b.variant_id AND o.status<>'cancelado' AND o.channel='consultora' AND o.client_id IS NOT NULL) ped ON true
 WHERE auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'consultora') AND c.consultora_party_id=public.my_party_id() AND c.status IN ('recebida','operacao') AND b.qty_available-coalesce(ped.ja,0)>0
 AND (coalesce(_categoria,'')='' OR cat.name=_categoria) AND (coalesce(_banho,'')='' OR coalesce(pt.name,pr.plating)=_banho)
 AND NOT EXISTS (SELECT 1 FROM regexp_split_to_table(lower(trim(coalesce(_busca,''))), E'\\s+') term WHERE term<>'' AND lower(concat_ws(' ',pr.name,v.label,v.barcode,v.sku,pr.internal_code,pr.reference_code,cat.name,pt.name,pr.plating)) NOT LIKE '%'||term||'%') LIMIT 300
) x;
$function$;

CREATE OR REPLACE FUNCTION public.consultant_order_create(_client uuid, _itens jsonb, _idempotency_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  eu uuid := public.my_party_id(); cli public.consultant_clients; existente public.sales_orders;
  pedido uuid; item record; preco integer; b public.kit_balances; nome text;
  total bigint := 0; contagem integer := 0; ja integer;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
  SELECT * INTO existente FROM public.sales_orders WHERE idempotency_key = _idempotency_key;
  IF existente.id IS NOT NULL THEN
    IF existente.consultora_party_id IS DISTINCT FROM eu THEN RAISE EXCEPTION 'Chave do pedido inválida.'; END IF;
    RETURN jsonb_build_object('order_id', existente.id, 'codigo', existente.code, 'total_cents', existente.subtotal_cents, 'repetido', true);
  END IF;
  SELECT * INTO cli FROM public.consultant_clients WHERE id = _client AND consultora_party_id = eu;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'Escolha uma cliente sua.'; END IF;
  IF jsonb_typeof(_itens) <> 'array' OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'Escolha pelo menos uma peça.'; END IF;
  IF jsonb_array_length(_itens) > 60 THEN RAISE EXCEPTION 'Pedido grande demais.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_itens) e WHERE coalesce((e->>'quantidade')::int,0) NOT BETWEEN 1 AND 99) THEN
    RAISE EXCEPTION 'Quantidade inválida.';
  END IF;

  INSERT INTO public.sales_orders (consultora_party_id, client_id, customer_name, customer_phone, customer_email, channel, status, idempotency_key)
  VALUES (eu, cli.id, cli.nome, cli.telefone, cli.email, 'consultora', 'em_atendimento', _idempotency_key)
  RETURNING id INTO pedido;

  -- Junta linhas repetidas da mesma peça e trava em ordem fixa (evita conflito entre vendas simultâneas).
  FOR item IN SELECT (e->>'cycle_id')::uuid cyc, (e->>'variant_id')::uuid vid, sum((e->>'quantidade')::int)::int q
              FROM jsonb_array_elements(_itens) e GROUP BY 1,2 ORDER BY 1,2 LOOP
    SELECT pr.name || coalesce(' (' || v.label || ')', '') INTO nome FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    nome := coalesce(nome, 'uma das peças');
    IF NOT EXISTS (SELECT 1 FROM public.kit_cycles c WHERE c.id = item.cyc AND c.consultora_party_id = eu AND c.status IN ('recebida','operacao')) THEN
      RAISE EXCEPTION 'A peça % não está numa maleta ativa sua.', nome;
    END IF;
    SELECT * INTO b FROM public.kit_balances WHERE cycle_id = item.cyc AND variant_id = item.vid FOR UPDATE;
    SELECT coalesce(sum(i.quantity), 0)::int INTO ja FROM public.sales_order_items i JOIN public.sales_orders o ON o.id = i.order_id
     WHERE i.cycle_id = item.cyc AND i.variant_id = item.vid AND o.status <> 'cancelado' AND o.channel = 'consultora' AND o.client_id IS NOT NULL AND o.id <> pedido;
    IF b.id IS NULL OR coalesce(b.qty_available,0) - ja < item.q THEN
      RAISE EXCEPTION 'A peça % já está em outro pedido seu. Restam % unidade(s) livre(s). Tire ela da venda ou cancele o outro pedido.', nome, greatest(coalesce(b.qty_available,0) - ja, 0);
    END IF;
    preco := public.kit_preco(item.cyc, item.vid);
    INSERT INTO public.sales_order_items (order_id, cycle_id, variant_id, product_name, variant_label, quantity, unit_price_cents)
    SELECT pedido, item.cyc, item.vid, pr.name, v.label, item.q, preco FROM public.product_variants v JOIN public.products pr ON pr.id = v.product_id WHERE v.id = item.vid;
    total := total + preco::bigint * item.q; contagem := contagem + item.q;
  END LOOP;

  UPDATE public.sales_orders SET subtotal_cents = total, items_count = contagem WHERE id = pedido;
  INSERT INTO public.sales_order_events (order_id, kind, to_status, actor_user_id, payload)
  VALUES (pedido, 'pedido.criado_consultora', 'em_atendimento', auth.uid(), jsonb_build_object('itens', contagem, 'reserva', false));
  RETURN jsonb_build_object('order_id', pedido, 'codigo', (SELECT code FROM public.sales_orders WHERE id = pedido), 'total_cents', total);
END $function$;
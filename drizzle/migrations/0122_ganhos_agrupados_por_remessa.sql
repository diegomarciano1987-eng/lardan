-- Regra inviolável: com vários kits da mesma consultora na mesma remessa, a faixa de
-- comissão é calculada sobre a SOMA vendida de todos os kits da remessa, nunca por kit.
CREATE OR REPLACE FUNCTION public.consultora_ganhos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE eu uuid := public.my_party_id(); c public.kit_cycles; ciclos uuid[]; vendido bigint := 0; pecas int := 0; pecas_total int := 0; valor_maleta bigint := 0;
        acerto date; f public.consultora_comissao_faixas; prox public.consultora_comissao_faixas;
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE consultora_party_id = eu AND status IN ('operacao','recebida','acerto')
    ORDER BY array_position(ARRAY['operacao','recebida','acerto']::text[], status::text), created_at DESC LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('maleta', false, 'configurado', EXISTS (SELECT 1 FROM public.consultora_comissao_faixas)); END IF;
  -- todos os kits dela na mesma remessa entram juntos na faixa
  SELECT array_agg(k.id), coalesce(sum(k.quantity_total),0), coalesce(sum(k.reference_total_cents),0)
    INTO ciclos, pecas_total, valor_maleta
    FROM public.kit_cycles k
   WHERE k.consultora_party_id = eu AND k.status IN ('operacao','recebida','acerto')
     AND (k.id = c.id OR (c.remessa_id IS NOT NULL AND k.remessa_id = c.remessa_id));
  SELECT coalesce(sum(i.quantity * i.unit_price_cents),0), coalesce(sum(i.quantity),0) INTO vendido, pecas
    FROM public.sales_order_items i JOIN public.sales_orders o ON o.id = i.order_id
   WHERE i.cycle_id = ANY (ciclos) AND o.consultora_party_id = eu AND o.status <> 'cancelado' AND (o.payment_status = 'pago' OR o.status = 'concluido');
  SELECT coalesce(r.data_acerto, (c.due_at AT TIME ZONE 'America/Sao_Paulo')::date) INTO acerto FROM (SELECT 1) x LEFT JOIN public.remessas r ON r.id = c.remessa_id;
  SELECT * INTO f FROM public.consultora_comissao_faixas WHERE min_vendido_cents <= vendido ORDER BY min_vendido_cents DESC LIMIT 1;
  SELECT * INTO prox FROM public.consultora_comissao_faixas WHERE min_vendido_cents > vendido ORDER BY min_vendido_cents LIMIT 1;
  RETURN jsonb_build_object('maleta', true, 'configurado', EXISTS (SELECT 1 FROM public.consultora_comissao_faixas),
    'vendido_cents', vendido, 'pecas_vendidas', pecas, 'pecas_total', pecas_total, 'valor_maleta_cents', valor_maleta,
    'kits', coalesce(array_length(ciclos, 1), 1),
    'acerto', acerto, 'hoje', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'faixa', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('titulo', f.titulo, 'percentual', f.percentual) END,
    'comissao_cents', CASE WHEN f.id IS NULL THEN 0 ELSE round(vendido * f.percentual / 100) END,
    'repasse_cents', CASE WHEN f.id IS NULL THEN NULL ELSE vendido - round(vendido * f.percentual / 100) END,
    'proxima', CASE WHEN prox.id IS NULL THEN NULL ELSE jsonb_build_object('titulo', prox.titulo, 'percentual', prox.percentual, 'falta_cents', prox.min_vendido_cents - vendido, 'min_cents', prox.min_vendido_cents) END);
END $function$;
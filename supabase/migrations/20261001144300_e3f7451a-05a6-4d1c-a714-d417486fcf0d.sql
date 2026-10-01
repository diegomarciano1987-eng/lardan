CREATE OR REPLACE FUNCTION public.consultant_pieces()
RETURNS TABLE (cycle_id uuid, variant_id uuid, produto text, variante text, disponivel integer, preco_cents integer, media_id uuid, maleta text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.cycle_id, b.variant_id, pr.name, v.label, b.qty_available, public.kit_reference_price(b.variant_id),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1),
         k.code
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.kits k ON k.id = c.kit_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
   WHERE public.has_role(auth.uid(),'consultora')
     AND c.consultora_party_id = public.my_party_id()
     AND c.status IN ('recebida','operacao')
     AND b.qty_available > 0
   ORDER BY pr.name, v.label
$$;
REVOKE ALL ON FUNCTION public.consultant_pieces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_pieces() TO authenticated;

CREATE OR REPLACE FUNCTION public.consultant_home()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eu uuid := public.my_party_id();
BEGIN
  IF auth.uid() IS NULL OR eu IS NULL OR NOT public.has_role(auth.uid(),'consultora') THEN
    RAISE EXCEPTION 'Acesso de consultora necessário.' USING errcode='42501';
  END IF;
  RETURN jsonb_build_object(
    'nome', (SELECT coalesce(nullif(p.social_name,''), p.display_name) FROM public.parties p WHERE p.id = eu),
    'clientes', (SELECT count(*) FROM public.consultant_clients WHERE consultora_party_id = eu),
    'retornos_hoje', (SELECT count(*) FROM public.consultant_clients WHERE consultora_party_id = eu AND proximo_retorno = current_date),
    'retornos_atrasados', (SELECT count(*) FROM public.consultant_clients WHERE consultora_party_id = eu AND proximo_retorno < current_date),
    'pedidos_abertos', (SELECT count(*) FROM public.sales_orders WHERE consultora_party_id = eu AND status IN ('aguardando_atendimento','em_atendimento','aguardando_pagamento')),
    'pedidos_novos', (SELECT count(*) FROM public.sales_orders WHERE consultora_party_id = eu AND status = 'aguardando_atendimento'),
    'pedidos_mes', (SELECT count(*) FROM public.sales_orders WHERE consultora_party_id = eu AND created_at >= date_trunc('month', now())),
    'maletas_receber', (SELECT count(*) FROM public.kit_cycles WHERE consultora_party_id = eu AND status = 'transito'),
    'maletas_conferir', (SELECT count(*) FROM public.kit_cycles WHERE consultora_party_id = eu AND status = 'recebida'),
    'pecas_disponiveis', (SELECT coalesce(sum(b.qty_available),0) FROM public.kit_balances b JOIN public.kit_cycles c ON c.id = b.cycle_id
                           WHERE c.consultora_party_id = eu AND c.status IN ('recebida','operacao'))
  );
END $$;
REVOKE ALL ON FUNCTION public.consultant_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_home() TO authenticated;
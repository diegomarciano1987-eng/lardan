-- Limpeza autorizada de conta de consultora de teste: pedidos sem cobrança, jornada e atendimentos.
-- Preserva vitrine, perfil, maletas (histórico de estoque) e pedidos com título/cobrança Asaas. Backup integral em fin_expurgo_backup.
CREATE OR REPLACE FUNCTION public.consultora_limpar_conta_teste(_party uuid, _lote text, _motivo text, _confirmacao text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pedidos uuid[]; clientes uuid[]; n_ped int; n_cli int; n_ev int; n_it int; n_ct int; n_st int;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Rotina interna.' USING errcode = '42501'; END IF;
  IF _confirmacao IS DISTINCT FROM 'LIMPAR CONTA DE TESTE' OR coalesce(_lote,'') = '' OR coalesce(_motivo,'') = '' THEN RAISE EXCEPTION 'Confirmação inválida.'; END IF;
  IF EXISTS (SELECT 1 FROM public.fin_expurgo_backup WHERE lote = _lote) THEN RETURN jsonb_build_object('repetido', true); END IF;

  SELECT coalesce(array_agg(id), '{}') INTO pedidos FROM public.sales_orders
   WHERE consultora_party_id = _party AND pay_title_id IS NULL AND pay_charge_id IS NULL AND pay_installment_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.fiscal_documents f WHERE f.order_id = sales_orders.id)
     AND NOT EXISTS (SELECT 1 FROM public.consultora_pos_venda p WHERE p.order_id = sales_orders.id);
  SELECT coalesce(array_agg(c.id), '{}') INTO clientes FROM public.consultant_clients c
   WHERE c.consultora_party_id = _party
     AND NOT EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.client_id = c.id AND NOT (o.id = ANY (pedidos)));

  INSERT INTO public.fin_expurgo_backup (lote, motivo, tabela, registro_id, registro)
  SELECT _lote, _motivo, 'sales_orders', id, to_jsonb(o) FROM public.sales_orders o WHERE id = ANY (pedidos)
  UNION ALL SELECT _lote, _motivo, 'sales_order_items', id, to_jsonb(i) FROM public.sales_order_items i WHERE order_id = ANY (pedidos)
  UNION ALL SELECT _lote, _motivo, 'sales_order_events', id, to_jsonb(e) FROM public.sales_order_events e WHERE order_id = ANY (pedidos)
  UNION ALL SELECT _lote, _motivo, 'consultant_clients', id, to_jsonb(c) FROM public.consultant_clients c WHERE id = ANY (clientes)
  UNION ALL SELECT _lote, _motivo, 'consultant_client_contacts', id, to_jsonb(x) FROM public.consultant_client_contacts x WHERE client_id = ANY (clientes)
  UNION ALL SELECT _lote, _motivo, 'consultant_client_stage_events', id, to_jsonb(s) FROM public.consultant_client_stage_events s WHERE client_id = ANY (clientes);

  ALTER TABLE public.sales_order_events DISABLE TRIGGER trg_sales_order_events_immutable;
  DELETE FROM public.sales_order_events WHERE order_id = ANY (pedidos); GET DIAGNOSTICS n_ev = ROW_COUNT;
  ALTER TABLE public.sales_order_events ENABLE TRIGGER trg_sales_order_events_immutable;
  DELETE FROM public.sales_order_items WHERE order_id = ANY (pedidos); GET DIAGNOSTICS n_it = ROW_COUNT;
  DELETE FROM public.sales_orders WHERE id = ANY (pedidos); GET DIAGNOSTICS n_ped = ROW_COUNT;
  DELETE FROM public.consultant_client_contacts WHERE client_id = ANY (clientes); GET DIAGNOSTICS n_ct = ROW_COUNT;
  DELETE FROM public.consultant_client_stage_events WHERE client_id = ANY (clientes); GET DIAGNOSTICS n_st = ROW_COUNT;
  DELETE FROM public.consultant_clients WHERE id = ANY (clientes); GET DIAGNOSTICS n_cli = ROW_COUNT;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (NULL, 'consultora_limpar_conta_teste', 'parties', _party,
    jsonb_build_object('lote', _lote, 'motivo', _motivo, 'pedidos', n_ped, 'itens', n_it, 'eventos', n_ev, 'clientes', n_cli, 'atendimentos', n_ct, 'etapas', n_st));
  RETURN jsonb_build_object('pedidos', n_ped, 'itens', n_it, 'eventos', n_ev, 'clientes', n_cli, 'atendimentos', n_ct, 'etapas', n_st);
END $$;
REVOKE ALL ON FUNCTION public.consultora_limpar_conta_teste(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consultora_limpar_conta_teste(uuid,text,text,text) TO service_role;
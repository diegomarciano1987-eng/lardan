
CREATE OR REPLACE FUNCTION public.kit_detail(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.kit_cycles; comp uuid; k public.kits;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo não encontrado.'; END IF;
  PERFORM public.kit_require_cycle(_cycle);

  SELECT * INTO k FROM public.kits WHERE id = c.kit_id;
  SELECT id INTO comp FROM public.kit_compositions WHERE cycle_id = _cycle
   ORDER BY version DESC LIMIT 1;

  RETURN jsonb_build_object(
    'ciclo', to_jsonb(c),
    'maleta', jsonb_build_object('id', k.id, 'codigo', k.code, 'etiqueta', k.label,
                                 'qr_token', k.qr_token),
    'consultora', (SELECT display_name FROM public.parties WHERE id = c.consultora_party_id),
    'representante', (SELECT display_name FROM public.parties WHERE id = c.representante_party_id),
    'custodia', (SELECT display_name FROM public.parties WHERE id = c.custodian_party_id),
    'composicao', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', ci.variant_id,
        'produto', pr.name,
        'variante', v.label,
        'sku', v.sku,
        'quantidade', ci.quantity,
        'valor_unitario', ci.unit_reference_cents,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1))
        ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_composition_items ci
      JOIN public.product_variants v ON v.id = ci.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE ci.composition_id = comp),
    'saldos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'variant_id', b.variant_id,
        'produto', pr.name,
        'variante', v.label,
        'alocado', b.qty_allocated,
        'aceito', b.qty_accepted,
        'divergente', b.qty_divergent,
        'vendido', b.qty_sold,
        'reservado', b.qty_reserved,
        'disponivel', b.qty_available,
        'publicado', b.is_published,
        'media_id', (SELECT pm.media_id FROM public.product_media pm
                      WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1))
        ORDER BY pr.name), '[]'::jsonb)
      FROM public.kit_balances b
      JOIN public.product_variants v ON v.id = b.variant_id
      JOIN public.products pr ON pr.id = v.product_id
      WHERE b.cycle_id = _cycle),
    'entregas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'seq', t.seq, 'situacao', t.status,
        'de', (SELECT display_name FROM public.parties WHERE id = t.from_party_id),
        'para', (SELECT display_name FROM public.parties WHERE id = t.to_party_id),
        'para_party_id', t.to_party_id,
        'transportadora', t.carrier, 'rastreio', t.tracking_code,
        'enviada_em', t.shipped_at, 'entregue_em', t.delivered_at,
        'recusada_em', t.refused_at, 'motivo', t.refusal_reason) ORDER BY t.seq), '[]'::jsonb)
      FROM public.kit_transfers t WHERE t.cycle_id = _cycle),
    'eventos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'de', e.from_status, 'para', e.to_status,
        'quando', e.created_at, 'payload', e.payload, 'motivo', e.reason)
        ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.kit_events e WHERE e.cycle_id = _cycle));
END $$;

REVOKE EXECUTE ON FUNCTION public.kit_detail(uuid) FROM anon;

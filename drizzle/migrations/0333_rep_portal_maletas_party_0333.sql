CREATE OR REPLACE FUNCTION public.rep_portal_maletas(_rep uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'a_receber', coalesce((SELECT jsonb_agg(jsonb_build_object('transfer_id', t.id, 'cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'consultora_codigo', pc.code, 'abertura_numero', c.abertura_numero,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'enviada_em', t.shipped_at)
        ORDER BY r.numero NULLS LAST, (c.consultora_party_id IS NOT NULL), c.abertura_numero NULLS LAST, pc.display_name NULLS LAST, k.code)
      FROM kit_transfers t JOIN kit_cycles c ON c.id = t.cycle_id JOIN kits k ON k.id = c.kit_id
      LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE t.to_party_id = _rep AND t.status = 'transito'), '[]'::jsonb),
    'sem_consultora', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'praca', pr.nome,
        'abertura_numero', c.abertura_numero,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'acerto', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto))
        ORDER BY r.numero NULLS LAST, c.abertura_numero NULLS LAST, k.code)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN cob_pracas pr ON pr.id = r.praca_id
     WHERE c.custodian_party_id = _rep AND c.consultora_party_id IS NULL AND c.status = 'transito'), '[]'::jsonb),
    'para_entregar', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora_party_id', pc.id, 'consultora', pc.display_name, 'consultora_codigo', pc.code, 'abertura_numero', c.abertura_numero,
        'telefone', (SELECT cp.value FROM contact_points cp WHERE cp.party_id = pc.id AND cp.kind IN ('whatsapp','telefone')
                      ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at LIMIT 1),
        'cidade', (SELECT pa.city FROM party_addresses pa WHERE pa.party_id = pc.id ORDER BY pa.created_at DESC LIMIT 1),
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND NOT EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito'))), '[]'::jsonb),
    'a_caminho', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'consultora', pc.display_name,
        'consultora_party_id', pc.id,
        'telefone', (SELECT cp.value FROM contact_points cp WHERE cp.party_id = pc.id AND cp.kind IN ('whatsapp','telefone')
                      ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at LIMIT 1),
        'abertura_numero', c.abertura_numero, 'pecas', c.quantity_total) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.to_party_id = c.consultora_party_id AND t.status = 'transito')), '[]'::jsonb));
END $function$;
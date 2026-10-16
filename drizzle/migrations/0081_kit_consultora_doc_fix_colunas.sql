
CREATE OR REPLACE FUNCTION public.kit_consultora_doc(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para ver os dados de impressão.';
  END IF;
  SELECT jsonb_build_object(
    'nome', pa.display_name,
    'doc', pa.doc,
    'rg', pa.rg,
    'praca', pr.nome,
    'endereco', (SELECT btrim(concat_ws(', ', ad.street, ad.street_number)) FROM party_addresses ad
                  WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'bairro', (SELECT ad.district FROM party_addresses ad
                WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad
                WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'cep', (SELECT ad.postal_code FROM party_addresses ad
                WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
    'whatsapp', (SELECT ct.value FROM contact_points ct
                  WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp'
                  ORDER BY ct.created_at LIMIT 1),
    'vencimento', kc.due_at
  ) INTO v
  FROM kit_cycles kc
  JOIN parties pa ON pa.id = kc.consultora_party_id
  LEFT JOIN consultant_profiles cp ON cp.party_id = pa.id
  LEFT JOIN cob_pracas pr ON pr.id = cp.praca_id
  WHERE kc.id = _cycle;
  IF v IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;
  RETURN v;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kit_consultora_doc(uuid) TO authenticated;

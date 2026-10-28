-- 0169 — Pedido de consignação: primeira coluna da folha passa a ser a REFERÊNCIA da peça
-- (product_variants.reference_code, com fallback para legacy_code). O sku (código de barras) continua no payload.
CREATE OR REPLACE FUNCTION public.kit_pedido_dados(_cycle uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE kc kit_cycles; r remessas; cfg pedido_config; pa parties; v jsonb; kit_no int; montador text; codigo text;
BEGIN
  IF NOT public.can_manage_kits(auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para imprimir o pedido.' USING errcode = '42501'; END IF;
  SELECT * INTO kc FROM kit_cycles WHERE id = _cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF kc.consultora_party_id IS NULL THEN RAISE EXCEPTION 'Maleta sem consultora definida.'; END IF;
  SELECT * INTO r FROM remessas WHERE id = kc.remessa_id;
  SELECT * INTO cfg FROM pedido_config;
  SELECT * INTO pa FROM parties WHERE id = kc.consultora_party_id;

  SELECT count(*) INTO kit_no FROM kit_cycles x
   WHERE x.remessa_id IS NOT DISTINCT FROM kc.remessa_id AND kc.remessa_id IS NOT NULL
      AND x.consultora_party_id = kc.consultora_party_id AND x.status <> 'cancelada' AND x.created_at <= kc.created_at;
  codigo := CASE WHEN pa.code ~ '^[0-9]{1,5}$' THEN lpad(pa.code, 5, '0') ELSE pa.code END;

  -- quem montou: quem mais bipou nesta maleta; senão quem criou a composição
  SELECT p.full_name INTO montador FROM montagem_operacoes o JOIN profiles p ON p.id = o.actor_user_id
   WHERE o.cycle_id = _cycle GROUP BY p.full_name ORDER BY sum(abs(o.delta)) DESC, max(o.created_at) DESC LIMIT 1;
  IF montador IS NULL THEN
    SELECT p.full_name INTO montador FROM kit_compositions c JOIN profiles p ON p.id = c.created_by
     WHERE c.cycle_id = _cycle ORDER BY c.version DESC LIMIT 1;
  END IF;

  SELECT jsonb_build_object(
    'empresa', to_jsonb(cfg) - 'id' - 'atualizado_por' - 'atualizado_em' - 'preco_virada_em',
    'remessa', jsonb_build_object(
      'numero', r.numero, 'kit', greatest(kit_no, 1), 'tipo_envio', coalesce(r.tipo_envio, 'pessoal'),
      'data_acerto', coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date),
      'postar_ate', CASE WHEN r.tipo_envio = 'correio' AND coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date) IS NOT NULL
                         THEN coalesce(r.data_acerto, (kc.due_at AT TIME ZONE 'America/Sao_Paulo')::date) - cfg.prazo_correio_dias END),
    'maleta', (SELECT k.code FROM kits k WHERE k.id = kc.kit_id),
    'cliente_codigo', codigo,
    'consultora', jsonb_build_object(
      'nome', pa.display_name,
      'endereco', (SELECT btrim(concat_ws(' · ', nullif(btrim(concat_ws(', ', ad.street, ad.street_number)), ''), ad.district))
                     FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
      'cidade', (SELECT ad.city || '/' || ad.uf FROM party_addresses ad WHERE ad.party_id = pa.id ORDER BY ad.is_primary DESC, ad.created_at LIMIT 1),
      'whatsapp', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = pa.id AND ct.kind = 'whatsapp' ORDER BY ct.is_primary DESC, ct.created_at LIMIT 1)),
    'representante', (SELECT jsonb_build_object(
        'nome', rp.display_name,
        'praca', coalesce((SELECT cp2.nome FROM cob_pracas cp2 WHERE cp2.id = r.praca_id),
                          (SELECT cp3.nome FROM consultant_profiles c3 JOIN cob_pracas cp3 ON cp3.id = c3.praca_id WHERE c3.party_id = pa.id)),
        'telefone', (SELECT ct.value FROM contact_points ct WHERE ct.party_id = rp.id AND ct.kind::text IN ('whatsapp', 'phone', 'telefone', 'celular', 'mobile')
                      ORDER BY (ct.kind = 'whatsapp') DESC, ct.is_primary DESC, ct.created_at LIMIT 1))
      FROM parties rp WHERE rp.id = coalesce(r.representante_party_id, kc.representante_party_id)),
    'montado_por', montador,
    'faixas', coalesce((SELECT jsonb_agg(jsonb_build_object('min_cents', f.min_vendido_cents, 'percentual', f.percentual) ORDER BY f.min_vendido_cents)
                         FROM consultora_comissao_faixas f), '[]'::jsonb),
    'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'variant_id', i.variant_id, 'sku', coalesce(nullif(v.sku, ''), pr.internal_code),
          'referencia', coalesce(nullif(v.reference_code, ''), v.legacy_code),
          'descricao', btrim(pr.name || CASE WHEN nullif(btrim(v.label), '') IS NULL OR upper(btrim(v.label)) IN ('U', 'UN', 'UNICO', 'ÚNICO', 'PADRAO', 'PADRÃO')
                                             THEN '' ELSE ' ' || btrim(v.label) END),
          'preco_cents', i.unit_reference_cents, 'quantidade', i.quantity,
          'grupo', public.pedido_grupo_peca(cat.name, coalesce(v.sku, pr.internal_code), pr.name))
        ORDER BY pr.name, v.label)
      FROM kit_composition_items i
      JOIN kit_compositions c ON c.id = i.composition_id
      JOIN product_variants v ON v.id = i.variant_id
      JOIN products pr ON pr.id = v.product_id
      LEFT JOIN categories cat ON cat.id = pr.category_id
     WHERE c.id = (SELECT c2.id FROM kit_compositions c2 WHERE c2.cycle_id = _cycle ORDER BY c2.version DESC LIMIT 1)
       AND i.quantity > 0), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.kit_pedido_dados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_pedido_dados(uuid) TO authenticated, service_role;

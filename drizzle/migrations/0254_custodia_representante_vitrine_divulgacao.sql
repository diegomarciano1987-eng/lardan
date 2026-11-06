-- 0254: remessa com representante. Fábrica -> representante (custódia) -> consultora (recebi + aceite).

-- 1) App da consultora só trava para aceite quando a maleta está realmente indo para ela (ou já chegou).
CREATE OR REPLACE FUNCTION public.consultora_aceites_pendentes()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE eu uuid:=public.my_party_id();
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id',c.id,'codigo',k.code,'situacao',c.status,'remessa',r.numero) ORDER BY c.created_at,c.id)
 FROM kit_cycles c JOIN kits k ON k.id=c.kit_id LEFT JOIN remessas r ON r.id=c.remessa_id
 WHERE c.consultora_party_id=eu
   AND (c.status = 'recebida'
        OR (c.status IN ('expedida','transito')
            AND EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id=c.id AND t.to_party_id=eu AND t.status='transito')))
   AND EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.party_id=eu AND p.is_active)
   AND NOT EXISTS(SELECT 1 FROM kit_acceptances a WHERE a.cycle_id=c.id)), '[]'::jsonb);
END $function$;

-- 2) Vitrine: peças da maleta que já saiu (com o representante / a caminho) aparecem para divulgar,
--    marcadas em_breve; compra continua só em recebida/operacao (vitrine_comprar / showcase_order_create inalterados).
CREATE OR REPLACE FUNCTION public.showcase_items_for(_party uuid, _design jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord, x->>'produto'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'cycle_id', coalesce(min(b.cycle_id::text) FILTER (WHERE c.status IN ('recebida','operacao')), min(b.cycle_id::text))::uuid,
      'variant_id', v.id, 'produto', pr.name, 'slug', pr.slug, 'variante', v.label,
      'tamanho', v.size, 'cor', v.color, 'categoria', cat.name,
      'referencia', public.peca_referencia_etiqueta(v.reference_code, pr.reference_code),
      'disponivel', coalesce(sum(b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id)) FILTER (WHERE c.status IN ('recebida','operacao')), 0)::int,
      'em_breve', NOT bool_or(c.status IN ('recebida','operacao')),
      'preco_cents', public.kit_preco_da_consultora(_party, v.id),
      'media_id', coalesce(
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id
             AND pm.media_id::text = _design#>>ARRAY['organizacao','fotos',v.id::text]),
         (SELECT pm.media_id FROM public.product_media pm WHERE pm.product_id = pr.id ORDER BY pm.position LIMIT 1)),
      'midias', (SELECT coalesce(jsonb_agg(pm.media_id ORDER BY pm.position), '[]') FROM public.product_media pm WHERE pm.product_id = pr.id),
      'ilustracao', (SELECT '/api/public/vitrine-ilus/' || si.party_id || '/' || si.variant_id
          FROM public.showcase_illustrations si
         WHERE si.party_id = _party AND si.variant_id = v.id
           AND NOT EXISTS (SELECT 1 FROM public.product_media pm2 WHERE pm2.product_id = pr.id))
    ) AS x,
    coalesce((SELECT o FROM jsonb_array_elements_text(coalesce(_design#>'{organizacao,ordem}','[]')) WITH ORDINALITY q(e,o) WHERE e = v.id::text), 100000) AS ord
    FROM public.kit_balances b
    JOIN public.kit_cycles c ON c.id = b.cycle_id
    JOIN public.product_variants v ON v.id = b.variant_id
    JOIN public.products pr ON pr.id = v.product_id
    LEFT JOIN public.categories cat ON cat.id = pr.category_id
    WHERE c.consultora_party_id = _party AND c.status IN ('expedida','transito','recebida','operacao')
      AND b.is_published AND b.qty_available - public.pedidos_abertos_qtd(b.cycle_id, b.variant_id) > 0 AND v.is_active
      AND pr.status <> 'arquivado'
      AND coalesce(public.kit_preco_da_consultora(_party, v.id), 0) > 0
    GROUP BY v.id, pr.id, cat.name
  ) s
$function$;

-- 3) Portal do representante: maletas com consultora que estão com ele para entregar em mãos.
CREATE OR REPLACE FUNCTION public.rep_portal_maletas(_rep uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.rep_portal_pode(_rep) THEN RAISE EXCEPTION 'Sem permissão.' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'a_receber', coalesce((SELECT jsonb_agg(jsonb_build_object('transfer_id', t.id, 'cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'consultora_codigo', pc.code, 'abertura_numero', c.abertura_numero,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'enviada_em', t.shipped_at) ORDER BY r.numero, pc.display_name NULLS LAST)
      FROM kit_transfers t JOIN kit_cycles c ON c.id = t.cycle_id JOIN kits k ON k.id = c.kit_id
      LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE t.to_party_id = _rep AND t.status = 'transito'), '[]'::jsonb),
    'sem_consultora', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'praca', pr.nome,
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents, 'acerto', coalesce((c.due_at AT TIME ZONE 'America/Sao_Paulo')::date, r.data_acerto)) ORDER BY r.numero, k.code)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id LEFT JOIN cob_pracas pr ON pr.id = r.praca_id
     WHERE c.custodian_party_id = _rep AND c.consultora_party_id IS NULL AND c.status = 'transito'), '[]'::jsonb),
    'para_entregar', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero,
        'consultora', pc.display_name, 'consultora_codigo', pc.code,
        'telefone', (SELECT cp.value FROM contact_points cp WHERE cp.party_id = pc.id AND cp.kind IN ('whatsapp','telefone')
                      ORDER BY (cp.kind = 'whatsapp') DESC, cp.is_primary DESC, cp.created_at LIMIT 1),
        'cidade', (SELECT pa.city FROM party_addresses pa WHERE pa.party_id = pc.id ORDER BY pa.created_at DESC LIMIT 1),
        'pecas', c.quantity_total, 'valor_cents', c.reference_total_cents) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND NOT EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.status IN ('pendente','transito'))), '[]'::jsonb),
    'a_caminho', coalesce((SELECT jsonb_agg(jsonb_build_object('cycle_id', c.id, 'maleta', k.code, 'remessa', r.numero, 'consultora', pc.display_name,
        'pecas', c.quantity_total) ORDER BY pc.display_name)
      FROM kit_cycles c JOIN kits k ON k.id = c.kit_id LEFT JOIN remessas r ON r.id = c.remessa_id JOIN parties pc ON pc.id = c.consultora_party_id
     WHERE c.custodian_party_id = _rep AND c.status = 'transito'
       AND EXISTS (SELECT 1 FROM kit_transfers t WHERE t.cycle_id = c.id AND t.to_party_id = c.consultora_party_id AND t.status = 'transito')), '[]'::jsonb));
END $function$;

-- 4) Equipe: entregar todas as maletas conferidas da remessa ao representante (lote, idempotente).
CREATE OR REPLACE FUNCTION public.remessa_expedir_representante(_remessa uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := public.kit_require_manage(); c record; n int := 0; r remessas;
BEGIN
  SELECT * INTO r FROM remessas WHERE id = _remessa;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Remessa não encontrada.'; END IF;
  IF r.tipo_envio = 'correio' THEN RAISE EXCEPTION 'Remessa pelos Correios: a saída é confirmada pelo rastreio.'; END IF;
  FOR c IN SELECT id FROM kit_cycles WHERE remessa_id = _remessa AND status = 'conferida' AND representante_party_id IS NOT NULL ORDER BY created_at LOOP
    PERFORM public.kit_expedir(c.id, jsonb_build_object('rota','representante','note','Remessa ' || r.numero || ' entregue ao representante'));
    n := n + 1;
  END LOOP;
  INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, payload)
  VALUES (uid, 'remessa.expedida_representante', 'remessas', _remessa, jsonb_build_object('maletas', n));
  RETURN jsonb_build_object('maletas', n);
END $function$;
GRANT EXECUTE ON FUNCTION public.remessa_expedir_representante(uuid) TO authenticated;

-- 5) Correção: maleta "entregue direto" à consultora por engano volta para a custódia do representante.
--    Só sem aceite e sem termo; fica no histórico de entregas.
CREATE OR REPLACE FUNCTION public.kit_devolver_custodia_representante(_cycle uuid, _motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE uid uuid := public.kit_require_manage(); c kit_cycles; n int; tid uuid;
BEGIN
  IF length(btrim(coalesce(_motivo,''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO c FROM kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  IF public.kit_cycle_in_scope(_cycle) IS NOT TRUE THEN RAISE EXCEPTION 'Esta maleta não está no seu alcance.' USING errcode='42501'; END IF;
  IF c.status <> 'recebida' OR c.representante_party_id IS NULL THEN RAISE EXCEPTION 'Só vale para maleta com a consultora, ainda sem aceite, de remessa com representante.'; END IF;
  IF EXISTS (SELECT 1 FROM kit_acceptances WHERE cycle_id = _cycle) OR EXISTS (SELECT 1 FROM kit_signature_requests WHERE cycle_id = _cycle) THEN
    RAISE EXCEPTION 'A consultora já começou o aceite desta maleta.';
  END IF;
  IF EXISTS (SELECT 1 FROM kit_transfers WHERE cycle_id = _cycle AND status IN ('pendente','transito')) THEN RAISE EXCEPTION 'Há uma entrega em andamento.'; END IF;
  SELECT coalesce(max(seq),0)+1 INTO n FROM kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO kit_transfers (cycle_id, seq, status, from_party_id, to_party_id, from_location_id, to_location_id, shipped_at, delivered_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'entregue', c.custodian_party_id, c.representante_party_id, c.current_location_id, c.current_location_id, now(), now(),
          'Correção: volta para a custódia do representante. ' || btrim(_motivo), uid, uid)
  RETURNING id INTO tid;
  UPDATE kit_cycles SET status = 'transito', custodian_party_id = c.representante_party_id, received_at = NULL, updated_by = uid WHERE id = _cycle;
  INSERT INTO kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'custodia.devolvida_representante', 'recebida', 'transito', uid, jsonb_build_object('transferencia', tid, 'representante', c.representante_party_id), btrim(_motivo));
  RETURN jsonb_build_object('situacao','transito','custodia', c.representante_party_id);
END $function$;
GRANT EXECUTE ON FUNCTION public.kit_devolver_custodia_representante(uuid, text) TO authenticated;
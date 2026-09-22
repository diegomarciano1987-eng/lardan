CREATE OR REPLACE FUNCTION public.kit_acrescimo_confirmar(_movement uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  m public.kit_movements; c public.kit_cycles; it record; total integer := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO m FROM public.kit_movements WHERE id = _movement FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Movimentação não encontrada.'; END IF;
  IF m.kind <> 'acrescimo' THEN RAISE EXCEPTION 'Esta movimentação não é um acréscimo.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = m.cycle_id FOR UPDATE;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR eu IS DISTINCT FROM coalesce(c.custodian_party_id, c.consultora_party_id)) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode confirmar o recebimento.' USING errcode='42501';
  END IF;

  IF m.status = 'confirmado' THEN
    RETURN jsonb_build_object('movement_id', m.id, 'repetida', true, 'situacao','confirmado');
  END IF;
  IF m.status = 'cancelado' THEN RAISE EXCEPTION 'Acréscimo cancelado.'; END IF;

  FOR it IN SELECT * FROM public.kit_movement_items WHERE movement_id = m.id LOOP
    UPDATE public.kit_balances
       SET qty_incoming = greatest(qty_incoming - it.quantity, 0),
           qty_allocated = qty_allocated + it.quantity,
           qty_accepted = qty_accepted + it.quantity,
           updated_at = now()
     WHERE cycle_id = m.cycle_id AND variant_id = it.variant_id;
    total := total + it.quantity;
  END LOOP;

  UPDATE public.kit_movements
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = uid, updated_at = now()
   WHERE id = m.id;

  IF m.transfer_id IS NOT NULL THEN
    UPDATE public.kit_transfers
       SET status = 'entregue', delivered_at = now(), updated_by = uid, updated_at = now()
     WHERE id = m.transfer_id;
  END IF;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.acrescimo.confirmado', uid,
          jsonb_build_object('movimento', m.id, 'quantidade', total));

  RETURN jsonb_build_object('movement_id', m.id, 'situacao','confirmado','quantidade', total);
END $$;

CREATE OR REPLACE FUNCTION public.kit_retorno(_cycle uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  c public.kit_cycles; loc uuid; mov uuid; it jsonb; idx integer := 0;
  destino text; qtd integer; disponivel integer; total integer := 0;
  idem text := nullif(_payload->>'idempotency_key','');
  hash text := md5(coalesce(_payload->'itens','[]'::jsonb)::text);
  existente public.kit_movements;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;

  IF idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kitret:' || idem, 0));
    SELECT * INTO existente FROM public.kit_movements WHERE idempotency_key = idem;
    IF existente.id IS NOT NULL THEN
      IF existente.payload_hash IS DISTINCT FROM hash THEN
        RAISE EXCEPTION 'Esta chave já foi usada para outro conteúdo.' USING errcode='22023';
      END IF;
      RETURN jsonb_build_object('movement_id', existente.id, 'repetida', true,
                                'situacao', existente.status);
    END IF;
  END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR eu IS DISTINCT FROM coalesce(c.custodian_party_id, c.consultora_party_id)) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode registrar o retorno.' USING errcode='42501';
  END IF;
  IF c.status NOT IN ('recebida','operacao','acerto') THEN
    RAISE EXCEPTION 'A maleta precisa estar recebida para registrar retorno.';
  END IF;
  IF jsonb_typeof(_payload->'itens') <> 'array' OR jsonb_array_length(_payload->'itens') = 0 THEN
    RAISE EXCEPTION 'Informe as peças do retorno.';
  END IF;

  loc := public.kit_location_ensure(c.kit_id);

  mov := public.kit_movement_open(_cycle, 'retorno', 'pendente',
    coalesce(c.custodian_party_id, c.consultora_party_id), NULL, loc, c.origin_location_id,
    NULL, uid, nullif(_payload->>'note',''), idem, hash);

  FOR it IN SELECT * FROM jsonb_array_elements(_payload->'itens') LOOP
    idx := idx + 1;
    destino := coalesce(nullif(it->>'destino',''), 'retorno');
    qtd := coalesce((it->>'quantity')::integer, 0);
    IF destino NOT IN ('retorno','garantia','perda','mantida') THEN
      RAISE EXCEPTION 'Destino inválido no item %.', idx;
    END IF;
    IF qtd <= 0 THEN RAISE EXCEPTION 'Quantidade inválida no item %.', idx; END IF;

    -- só peças já aceitas pela consultora podem ter destino registrado
    SELECT qty_accepted - qty_sold - qty_reserved - qty_returned - qty_return_transit
           - qty_retained - qty_warranty - qty_lost
      INTO disponivel
      FROM public.kit_balances
     WHERE cycle_id = _cycle AND variant_id = (it->>'variant_id')::uuid
     FOR UPDATE;
    IF disponivel IS NULL THEN
      RAISE EXCEPTION 'Peça do item % não pertence a esta maleta.', idx;
    END IF;
    IF qtd > disponivel THEN
      RAISE EXCEPTION 'Item %: quantidade maior do que a que ainda está sob responsabilidade (%).', idx, disponivel;
    END IF;

    INSERT INTO public.kit_movement_items (movement_id, variant_id, quantity, destino, reason)
    VALUES (mov, (it->>'variant_id')::uuid, qtd, destino, nullif(it->>'reason',''));

    IF destino IN ('retorno','garantia') THEN
      UPDATE public.kit_balances
         SET qty_return_transit = qty_return_transit + qtd, updated_at = now()
       WHERE cycle_id = _cycle AND variant_id = (it->>'variant_id')::uuid;
    ELSIF destino = 'mantida' THEN
      UPDATE public.kit_balances
         SET qty_retained = qty_retained + qtd, updated_at = now()
       WHERE cycle_id = _cycle AND variant_id = (it->>'variant_id')::uuid;
    ELSIF destino = 'perda' THEN
      IF nullif(it->>'reason','') IS NULL THEN
        RAISE EXCEPTION 'Item %: informe o motivo da perda.', idx;
      END IF;
      PERFORM public.register_stock_movement(
        'saida'::stock_move_kind, (it->>'variant_id')::uuid, qtd,
        loc, NULL, 'perda', NULL,
        'maleta:' || _cycle::text, 'Perda registrada no retorno da maleta',
        'maleta-perda:' || mov::text || ':' || idx::text, NULL);
      UPDATE public.kit_balances
         SET qty_lost = qty_lost + qtd, updated_at = now()
       WHERE cycle_id = _cycle AND variant_id = (it->>'variant_id')::uuid;
    END IF;

    total := total + qtd;
  END LOOP;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'maleta.retorno', uid,
    jsonb_build_object('movimento', mov, 'itens', idx, 'quantidade', total));

  RETURN jsonb_build_object('movement_id', mov, 'itens', idx, 'quantidade', total, 'situacao','pendente');
END $$;

CREATE OR REPLACE FUNCTION public.kit_conciliacao(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE linhas jsonb; tot jsonb;
BEGIN
  PERFORM public.kit_require_cycle(_cycle);

  WITH remessa AS (
    SELECT i.variant_id, sum(i.quantity)::integer q
      FROM public.kit_composition_items i
      JOIN public.kit_compositions comp ON comp.id = i.composition_id
     WHERE comp.cycle_id = _cycle
     GROUP BY 1
  ),
  acres AS (
    SELECT i.variant_id, sum(i.quantity)::integer q
      FROM public.kit_movement_items i
      JOIN public.kit_movements m ON m.id = i.movement_id
     WHERE m.cycle_id = _cycle AND m.kind = 'acrescimo' AND m.status = 'confirmado'
     GROUP BY 1
  ),
  base AS (
    SELECT b.variant_id,
           coalesce(r.q,0) AS enviado,
           coalesce(a.q,0) AS acrescido,
           b.qty_accepted AS aceito,
           b.qty_returned AS retornado,
           b.qty_return_transit AS retorno_em_transito,
           b.qty_warranty AS garantia,
           b.qty_lost AS perda,
           b.qty_retained AS mantida,
           b.qty_sold AS vendido,
           b.qty_incoming AS a_caminho
      FROM public.kit_balances b
      LEFT JOIN remessa r ON r.variant_id = b.variant_id
      LEFT JOIN acres a ON a.variant_id = b.variant_id
     WHERE b.cycle_id = _cycle
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', variant_id,
           'enviado', enviado, 'acrescido', acrescido, 'aceito', aceito,
           'saiu', enviado + acrescido,
           'retornado', retornado, 'retorno_em_transito', retorno_em_transito,
           'garantia', garantia, 'perda', perda, 'mantida', mantida,
           'vendido', vendido, 'a_caminho', a_caminho,
           'sob_responsabilidade', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - perda - mantida - vendido,
           'a_explicar', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - perda - mantida - vendido
         ) ORDER BY variant_id), '[]'::jsonb),
         jsonb_build_object(
           'saiu', coalesce(sum(enviado + acrescido),0),
           'aceito', coalesce(sum(aceito),0),
           'retornado', coalesce(sum(retornado),0),
           'retorno_em_transito', coalesce(sum(retorno_em_transito),0),
           'garantia', coalesce(sum(garantia),0),
           'perda', coalesce(sum(perda),0),
           'mantida', coalesce(sum(mantida),0),
           'vendido', coalesce(sum(vendido),0),
           'a_explicar', coalesce(sum((enviado + acrescido)
             - retornado - retorno_em_transito - garantia - perda - mantida - vendido),0))
    INTO linhas, tot
  FROM base;

  RETURN jsonb_build_object(
    'linhas', linhas,
    'totais', tot,
    'vendas_disponiveis', false,
    'aviso', 'Peças sem destino explicado não viram venda nem dívida automaticamente.');
END $$;
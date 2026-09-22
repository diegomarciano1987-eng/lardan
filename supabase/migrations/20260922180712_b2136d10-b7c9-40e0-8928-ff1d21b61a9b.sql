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
    IF destino = 'perda' AND nullif(it->>'reason','') IS NULL THEN
      RAISE EXCEPTION 'Item %: informe o motivo da perda.', idx;
    END IF;

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
      -- a baixa física da peça perdida ocorre quando a Matriz confirma o retorno
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

CREATE OR REPLACE FUNCTION public.kit_retorno_confirmar(_movement uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  m public.kit_movements; c public.kit_cycles; it record;
  loc uuid; destino_loc uuid; idx integer := 0; total integer := 0; perdidas integer := 0;
BEGIN
  SELECT * INTO m FROM public.kit_movements WHERE id = _movement FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Movimentação não encontrada.'; END IF;
  IF m.kind <> 'retorno' THEN RAISE EXCEPTION 'Esta movimentação não é um retorno.'; END IF;
  IF m.status = 'confirmado' THEN
    RETURN jsonb_build_object('movement_id', m.id, 'repetida', true, 'situacao','confirmado');
  END IF;
  IF m.status = 'cancelado' THEN RAISE EXCEPTION 'Retorno cancelado.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = m.cycle_id FOR UPDATE;
  loc := public.kit_location_ensure(c.kit_id);
  destino_loc := coalesce(nullif(_payload->>'destino_location_id','')::uuid, m.to_location_id, c.origin_location_id);
  IF destino_loc IS NULL THEN RAISE EXCEPTION 'Escolha o depósito que recebe o retorno.'; END IF;

  FOR it IN SELECT * FROM public.kit_movement_items WHERE movement_id = m.id ORDER BY created_at LOOP
    idx := idx + 1;
    IF it.destino IN ('retorno','garantia') THEN
      PERFORM public.register_stock_movement(
        'transferencia'::stock_move_kind, it.variant_id, it.quantity,
        loc, destino_loc, 'transferencia', NULL,
        'maleta:' || m.cycle_id::text, 'Retorno da maleta',
        'maleta-ret:' || m.id::text || ':' || idx::text, NULL);

      UPDATE public.kit_balances
         SET qty_return_transit = greatest(qty_return_transit - it.quantity, 0),
             qty_returned = qty_returned + CASE WHEN it.destino = 'retorno' THEN it.quantity ELSE 0 END,
             qty_warranty = qty_warranty + CASE WHEN it.destino = 'garantia' THEN it.quantity ELSE 0 END,
             updated_at = now()
       WHERE cycle_id = m.cycle_id AND variant_id = it.variant_id;

      total := total + it.quantity;
    ELSIF it.destino = 'perda' THEN
      PERFORM public.register_stock_movement(
        'saida'::stock_move_kind, it.variant_id, it.quantity,
        loc, NULL, 'perda', NULL,
        'maleta:' || m.cycle_id::text, 'Perda declarada no retorno da maleta',
        'maleta-perda:' || m.id::text || ':' || idx::text, NULL);
      perdidas := perdidas + it.quantity;
    END IF;
  END LOOP;

  UPDATE public.kit_movements
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = uid,
         to_location_id = destino_loc, updated_at = now()
   WHERE id = m.id;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.retorno.confirmado', uid,
          jsonb_build_object('movimento', m.id, 'itens', idx, 'quantidade', total,
                             'perdas', perdidas, 'deposito', destino_loc));

  RETURN jsonb_build_object('movement_id', m.id, 'situacao','confirmado',
                            'itens', idx, 'quantidade', total, 'perdas', perdidas);
END $$;
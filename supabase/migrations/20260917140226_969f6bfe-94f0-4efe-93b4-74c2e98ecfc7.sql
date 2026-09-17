-- ============================================================
-- NÚCLEO COMERCIAL — ETAPA 2: rotinas transacionais das maletas
-- ============================================================

-- local físico da maleta (criado sob demanda)
CREATE OR REPLACE FUNCTION public.kit_location_ensure(_kit_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.kits; loc uuid;
BEGIN
  SELECT * INTO k FROM public.kits WHERE id = _kit_id;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
  SELECT id INTO loc FROM public.locations WHERE code = k.code;
  IF loc IS NULL THEN
    INSERT INTO public.locations (code, name, kind, notes, is_active)
    VALUES (k.code, 'Maleta ' || k.code, 'maleta', 'Local físico da maleta ' || k.code, true)
    RETURNING id INTO loc;
  END IF;
  RETURN loc;
END $$;

CREATE OR REPLACE FUNCTION public.kit_reference_price(_variant uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT p.price_cents FROM public.public_price_list p WHERE p.variant_id = _variant),
    (SELECT v.price_cents FROM public.product_variants v WHERE v.id = _variant),
    0)
$$;

CREATE OR REPLACE FUNCTION public.kit_require_manage()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'kit.manage') THEN
    RAISE EXCEPTION 'Sem permissão para operar maletas.' USING errcode = '42501';
  END IF;
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION public.kit_totals_refresh(_cycle uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE comp uuid; q integer; v bigint;
BEGIN
  SELECT id INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  SELECT coalesce(sum(quantity),0), coalesce(sum(quantity::bigint * unit_reference_cents),0)
    INTO q, v FROM public.kit_composition_items WHERE composition_id = comp;
  UPDATE public.kit_cycles SET quantity_total = q, reference_total_cents = v WHERE id = _cycle;
END $$;

-- ---------------- abertura de ciclo ----------------
CREATE OR REPLACE FUNCTION public.kit_cycle_create(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  kit_id uuid := nullif(_payload->>'kit_id','')::uuid;
  k public.kits; n integer; cyc uuid; comp uuid; origem uuid;
BEGIN
  origem := nullif(_payload->>'origin_location_id','')::uuid;
  IF origem IS NULL THEN
    SELECT id INTO origem FROM public.locations
     WHERE kind = 'deposito' AND is_active ORDER BY code LIMIT 1;
  END IF;
  IF origem IS NULL THEN RAISE EXCEPTION 'Nenhum depósito ativo para montar a maleta.'; END IF;

  IF kit_id IS NULL THEN
    INSERT INTO public.kits (label, notes, created_by, updated_by)
    VALUES (nullif(_payload->>'label',''), nullif(_payload->>'notes',''), uid, uid)
    RETURNING * INTO k;
  ELSE
    SELECT * INTO k FROM public.kits WHERE id = kit_id;
    IF k.id IS NULL THEN RAISE EXCEPTION 'Maleta não encontrada.'; END IF;
    IF EXISTS (SELECT 1 FROM public.kit_cycles c
                WHERE c.kit_id = k.id AND c.status NOT IN ('encerrada','cancelada')) THEN
      RAISE EXCEPTION 'Esta maleta já possui um ciclo em aberto.';
    END IF;
  END IF;

  SELECT coalesce(max(cycle_no),0) + 1 INTO n FROM public.kit_cycles WHERE kit_id = k.id;

  INSERT INTO public.kit_cycles (
    kit_id, cycle_no, status, consultora_party_id, representante_party_id,
    origin_location_id, current_location_id, due_at, notes, created_by, updated_by)
  VALUES (
    k.id, n, 'montagem',
    nullif(_payload->>'consultora_party_id','')::uuid,
    nullif(_payload->>'representante_party_id','')::uuid,
    origem, origem,
    nullif(_payload->>'due_at','')::timestamptz,
    nullif(_payload->>'notes',''), uid, uid)
  RETURNING id INTO cyc;

  INSERT INTO public.kit_compositions (cycle_id, version, created_by)
  VALUES (cyc, 1, uid) RETURNING id INTO comp;

  INSERT INTO public.kit_events (cycle_id, kind, to_status, actor_user_id, payload)
  VALUES (cyc, 'ciclo.criado', 'montagem', uid,
          jsonb_build_object('maleta', k.code, 'ciclo', n));

  RETURN jsonb_build_object('cycle_id', cyc, 'kit_id', k.id, 'code', k.code,
                            'qr_token', k.qr_token, 'cycle_no', n, 'composition_id', comp);
END $$;

-- ---------------- montagem ----------------
CREATE OR REPLACE FUNCTION public.kit_item_upsert(_cycle uuid, _variant uuid, _qty integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp uuid; disp integer; preco integer;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'A composição já foi conferida e não pode mais ser alterada aqui.';
  END IF;

  SELECT id INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;

  IF _qty IS NULL OR _qty <= 0 THEN
    DELETE FROM public.kit_composition_items WHERE composition_id = comp AND variant_id = _variant;
    PERFORM public.kit_totals_refresh(_cycle);
    RETURN jsonb_build_object('removido', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;

  disp := public.stock_available(_variant, c.origin_location_id);
  IF disp < _qty THEN
    RAISE EXCEPTION 'Disponível apenas % no depósito de origem.', disp;
  END IF;

  preco := public.kit_reference_price(_variant);

  INSERT INTO public.kit_composition_items (composition_id, variant_id, quantity, unit_reference_cents)
  VALUES (comp, _variant, _qty, preco)
  ON CONFLICT (composition_id, variant_id)
  DO UPDATE SET quantity = excluded.quantity, unit_reference_cents = excluded.unit_reference_cents;

  UPDATE public.kit_cycles SET status = 'montagem', updated_by = uid WHERE id = _cycle;
  PERFORM public.kit_totals_refresh(_cycle);
  RETURN jsonb_build_object('composition_id', comp, 'variant_id', _variant,
                            'quantidade', _qty, 'valor_unitario', preco);
END $$;

-- ---------------- conferência (reserva o estoque) ----------------
CREATE OR REPLACE FUNCTION public.kit_conferir(_cycle uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  res jsonb; validade timestamptz; total integer := 0;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status = 'conferida' THEN
    RETURN jsonb_build_object('situacao','conferida','repetida',true);
  END IF;
  IF c.status NOT IN ('rascunho','montagem') THEN
    RAISE EXCEPTION 'Este ciclo está % e não pode ser conferido.', c.status;
  END IF;

  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.kit_composition_items WHERE composition_id = comp.id) THEN
    RAISE EXCEPTION 'A maleta está vazia.';
  END IF;

  validade := coalesce(c.due_at, now() + interval '30 days');
  IF validade <= now() THEN validade := now() + interval '30 days'; END IF;

  FOR it IN SELECT * FROM public.kit_composition_items WHERE composition_id = comp.id LOOP
    res := public.create_stock_reservation(
      it.variant_id, c.origin_location_id, it.quantity, validade,
      'maleta', c.id::text, c.consultora_party_id,
      'Conferência da maleta', 'maleta-conf:' || comp.id::text || ':' || it.variant_id::text);
    UPDATE public.kit_composition_items
       SET reservation_id = (res->>'id')::uuid WHERE id = it.id;
    total := total + it.quantity;
  END LOOP;

  UPDATE public.kit_compositions SET frozen_at = now(), frozen_by = uid, note = coalesce(_note, note)
   WHERE id = comp.id;
  UPDATE public.kit_cycles SET status = 'conferida', updated_by = uid WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'ciclo.conferido', c.status, 'conferida', uid,
          jsonb_build_object('composicao', comp.id, 'versao', comp.version, 'pecas', total), _note);

  RETURN jsonb_build_object('situacao','conferida','composition_id',comp.id,'pecas',total);
END $$;

-- ---------------- expedição ----------------
CREATE OR REPLACE FUNCTION public.kit_expedir(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  loc uuid; destino uuid; rota text; transfer uuid; movimentos integer := 0;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF c.status IN ('expedida','transito','recebida','operacao','acerto','encerrada') THEN
    RETURN jsonb_build_object('situacao', c.status, 'repetida', true,
      'mensagem','Esta maleta já foi expedida.');
  END IF;
  IF c.status <> 'conferida' THEN
    RAISE EXCEPTION 'Confira a maleta antes de expedir.';
  END IF;

  rota := coalesce(nullif(_payload->>'rota',''), CASE WHEN c.representante_party_id IS NOT NULL
            THEN 'representante' ELSE 'direta' END);
  destino := CASE WHEN rota = 'representante' THEN c.representante_party_id
                  ELSE c.consultora_party_id END;
  IF destino IS NULL THEN
    RAISE EXCEPTION 'Defina a consultora (ou o representante) antes de expedir.';
  END IF;

  loc := public.kit_location_ensure(c.kit_id);
  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;

  FOR it IN SELECT * FROM public.kit_composition_items WHERE composition_id = comp.id LOOP
    IF it.reservation_id IS NOT NULL THEN
      PERFORM public.release_stock_reservation(it.reservation_id, false,
        'Expedição da maleta', 'maleta-exp-rel:' || it.id::text);
    END IF;
    PERFORM public.register_stock_movement(
      'transferencia'::stock_move_kind, it.variant_id, it.quantity,
      c.origin_location_id, loc, 'transferencia', NULL,
      'maleta:' || c.id::text, 'Expedição da maleta',
      'maleta-exp:' || it.id::text, NULL);

    INSERT INTO public.kit_balances (cycle_id, variant_id, qty_allocated)
    VALUES (_cycle, it.variant_id, it.quantity)
    ON CONFLICT (cycle_id, variant_id)
    DO UPDATE SET qty_allocated = public.kit_balances.qty_allocated + excluded.qty_allocated,
                  updated_at = now();
    movimentos := movimentos + 1;
  END LOOP;

  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, 1, 'transito', NULL, destino, c.origin_location_id, loc,
    nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO transfer;

  UPDATE public.kit_cycles
     SET status = 'transito', shipped_at = now(), custodian_party_id = destino,
         current_location_id = loc, updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'ciclo.expedido', 'conferida', 'transito', uid,
          jsonb_build_object('rota', rota, 'destino', destino, 'transferencia', transfer,
                             'itens', movimentos));

  RETURN jsonb_build_object('situacao','transito','rota',rota,'transfer_id',transfer,'itens',movimentos);
END $$;

-- ---------------- cadeia de custódia ----------------
CREATE OR REPLACE FUNCTION public.kit_transfer_confirm(_transfer uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); t public.kit_transfers; c public.kit_cycles;
  recusar boolean := coalesce((_payload->>'recusar')::boolean, false);
  eu uuid := public.my_party_id();
BEGIN
  SELECT * INTO t FROM public.kit_transfers WHERE id = _transfer FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transferência não encontrada.'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = t.cycle_id FOR UPDATE;

  IF NOT (public.has_capability(uid,'kit.manage') OR t.to_party_id = eu) THEN
    RAISE EXCEPTION 'Somente quem está recebendo pode confirmar esta entrega.' USING errcode = '42501';
  END IF;

  IF t.status IN ('entregue','recusada') THEN
    RETURN jsonb_build_object('situacao', t.status, 'repetida', true);
  END IF;

  IF recusar THEN
    UPDATE public.kit_transfers
       SET status = 'recusada', refused_at = now(),
           refusal_reason = nullif(_payload->>'motivo',''), updated_by = uid
     WHERE id = t.id;
    INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload, reason)
    VALUES (c.id, 'entrega.recusada', uid, jsonb_build_object('transferencia', t.id),
            nullif(_payload->>'motivo',''));
    RETURN jsonb_build_object('situacao','recusada');
  END IF;

  UPDATE public.kit_transfers
     SET status = 'entregue', delivered_at = now(),
         evidence = coalesce(_payload->'evidencia', evidence), updated_by = uid
   WHERE id = t.id;

  UPDATE public.kit_cycles
     SET custodian_party_id = t.to_party_id,
         status = CASE WHEN t.to_party_id = c.consultora_party_id THEN 'recebida'::kit_status
                       ELSE c.status END,
         received_at = CASE WHEN t.to_party_id = c.consultora_party_id THEN now() ELSE received_at END,
         updated_by = uid
   WHERE id = c.id;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (c.id, 'entrega.confirmada', c.status,
          CASE WHEN t.to_party_id = c.consultora_party_id THEN 'recebida'::kit_status ELSE c.status END,
          uid, jsonb_build_object('transferencia', t.id, 'responsavel', t.to_party_id));

  RETURN jsonb_build_object('situacao','entregue','custodia', t.to_party_id);
END $$;

-- representante encaminha para a consultora
CREATE OR REPLACE FUNCTION public.kit_transfer_forward(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); c public.kit_cycles; eu uuid := public.my_party_id();
  n integer; novo uuid;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR c.custodian_party_id = eu) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode encaminhá-la.' USING errcode = '42501';
  END IF;
  IF c.consultora_party_id IS NULL THEN
    RAISE EXCEPTION 'Defina a consultora destinatária antes de encaminhar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.kit_transfers
              WHERE cycle_id = _cycle AND to_party_id = c.consultora_party_id
                AND status IN ('pendente','transito')) THEN
    RETURN jsonb_build_object('repetida', true, 'mensagem','Já existe uma entrega em andamento para a consultora.');
  END IF;

  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'transito', c.custodian_party_id, c.consultora_party_id,
    c.current_location_id, c.current_location_id,
    nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO novo;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'entrega.encaminhada', uid,
          jsonb_build_object('transferencia', novo, 'de', c.custodian_party_id,
                             'para', c.consultora_party_id));

  RETURN jsonb_build_object('transfer_id', novo, 'situacao','transito');
END $$;

-- ---------------- aceite da consultora ----------------
CREATE OR REPLACE FUNCTION public.kit_aceitar(_cycle uuid, _itens jsonb, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  c public.kit_cycles; comp public.kit_compositions; ac uuid; item jsonb;
  vid uuid; esperado integer; aceito integer; divergente integer;
  total_aceito integer := 0; total_div integer := 0; tipo public.kit_acceptance_kind;
  existente public.kit_acceptances;
BEGIN
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF NOT (public.has_capability(uid,'kit.manage') OR c.consultora_party_id = eu) THEN
    RAISE EXCEPTION 'Somente a consultora desta maleta pode aceitá-la.' USING errcode = '42501';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existente FROM public.kit_acceptances
     WHERE cycle_id = _cycle AND idempotency_key = _idempotency_key;
    IF existente.id IS NOT NULL THEN
      RETURN jsonb_build_object('acceptance_id', existente.id, 'repetida', true,
                                'situacao', c.status);
    END IF;
  END IF;

  IF c.status NOT IN ('transito','recebida') THEN
    IF c.status IN ('operacao','acerto','encerrada') THEN
      RAISE EXCEPTION 'Esta maleta já foi aceita.';
    END IF;
    RAISE EXCEPTION 'A maleta ainda não foi entregue.';
  END IF;

  SELECT * INTO comp FROM public.kit_compositions
   WHERE cycle_id = _cycle ORDER BY version DESC LIMIT 1;
  IF comp.frozen_at IS NULL THEN RAISE EXCEPTION 'Composição não conferida.'; END IF;

  INSERT INTO public.kit_acceptances (cycle_id, composition_id, kind, party_id, actor_user_id,
    context, idempotency_key)
  VALUES (_cycle, comp.id, 'integral', c.consultora_party_id, uid, '{}'::jsonb, _idempotency_key)
  RETURNING id INTO ac;

  FOR item IN SELECT * FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) LOOP
    vid := (item->>'variant_id')::uuid;
    SELECT quantity INTO esperado FROM public.kit_composition_items
     WHERE composition_id = comp.id AND variant_id = vid;
    IF esperado IS NULL THEN
      RAISE EXCEPTION 'Peça informada não faz parte desta maleta.';
    END IF;
    aceito := coalesce((item->>'qty_accepted')::integer, esperado);
    divergente := coalesce((item->>'qty_divergent')::integer, esperado - aceito);
    IF aceito < 0 OR divergente < 0 OR aceito + divergente > esperado THEN
      RAISE EXCEPTION 'Quantidades informadas não conferem com a maleta.';
    END IF;

    INSERT INTO public.kit_acceptance_items (acceptance_id, variant_id, qty_expected,
      qty_accepted, qty_divergent, divergence_reason, photos)
    VALUES (ac, vid, esperado, aceito, divergente,
            nullif(item->>'motivo',''), coalesce(item->'fotos','[]'::jsonb));

    UPDATE public.kit_balances
       SET qty_accepted = qty_accepted + aceito,
           qty_divergent = qty_divergent + divergente,
           updated_at = now()
     WHERE cycle_id = _cycle AND variant_id = vid;

    total_aceito := total_aceito + aceito;
    total_div := total_div + divergente;
  END LOOP;

  -- peças não informadas: aceite integral por omissão
  INSERT INTO public.kit_acceptance_items (acceptance_id, variant_id, qty_expected, qty_accepted, qty_divergent)
  SELECT ac, ci.variant_id, ci.quantity, ci.quantity, 0
    FROM public.kit_composition_items ci
   WHERE ci.composition_id = comp.id
     AND NOT EXISTS (SELECT 1 FROM public.kit_acceptance_items ai
                      WHERE ai.acceptance_id = ac AND ai.variant_id = ci.variant_id);

  UPDATE public.kit_balances b
     SET qty_accepted = b.qty_accepted + ai.qty_accepted, updated_at = now()
    FROM public.kit_acceptance_items ai
   WHERE ai.acceptance_id = ac AND b.cycle_id = _cycle AND b.variant_id = ai.variant_id
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(_itens,'[]'::jsonb)) x
        WHERE (x->>'variant_id')::uuid = ai.variant_id);

  SELECT coalesce(sum(qty_accepted),0), coalesce(sum(qty_divergent),0)
    INTO total_aceito, total_div
    FROM public.kit_acceptance_items WHERE acceptance_id = ac;

  tipo := CASE WHEN total_div > 0 THEN 'parcial'::public.kit_acceptance_kind
               ELSE 'integral'::public.kit_acceptance_kind END;
  UPDATE public.kit_acceptances SET kind = tipo WHERE id = ac;

  UPDATE public.kit_cycles
     SET status = 'operacao', received_at = coalesce(received_at, now()), updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'maleta.aceita', c.status, 'operacao', uid,
          jsonb_build_object('aceite', ac, 'tipo', tipo, 'aceitas', total_aceito,
                             'divergentes', total_div, 'composicao', comp.id));

  RETURN jsonb_build_object('acceptance_id', ac, 'tipo', tipo, 'aceitas', total_aceito,
                            'divergentes', total_div, 'situacao','operacao');
END $$;

REVOKE EXECUTE ON FUNCTION public.kit_location_ensure(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kit_totals_refresh(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.kit_require_manage() FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_cycle_create(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_item_upsert(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_conferir(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_expedir(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_transfer_confirm(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_transfer_forward(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.kit_aceitar(uuid, jsonb, text) FROM anon;

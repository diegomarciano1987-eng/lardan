-- Libera a cadeia montar -> conferir -> expedir maleta mesmo com estoque zerado
-- (peças na rua, contagem pendente). Tudo fica auditado; saldos podem ficar
-- negativos até a contagem, o que é exatamente a realidade física.

-- 1) register_stock_movement: permite saída/transferência acima do disponível
--    quando o chamador interno ligar o desbloqueio (lardan.stock_unblock=on).
CREATE OR REPLACE FUNCTION public.register_stock_movement(_kind stock_move_kind, _variant_id uuid, _quantity integer, _from_location_id uuid DEFAULT NULL::uuid, _to_location_id uuid DEFAULT NULL::uuid, _reason_code text DEFAULT NULL::text, _unit_cost_cents integer DEFAULT NULL::integer, _reference text DEFAULT NULL::text, _note text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text, _reservation_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  saldo integer; mov uuid; atual integer;
  a uuid; b uuid; motivo_ok boolean;
  pode_custo boolean;
  custo integer := _unit_cost_cents;
  custo_descartado boolean := false;
  fb integer; fa integer; tb integer; ta integer;
  res_from integer := 0; res_to integer := 0; livre integer;
  interno boolean := coalesce(current_setting('lardan.kit_stock', true), '') = 'on' OR coalesce(current_setting('lardan.stock_unblock', true), '') = 'on';
  desbloqueado boolean := coalesce(current_setting('lardan.stock_unblock', true), '') = 'on';
BEGIN
  IF NOT interno THEN
    IF uid IS NULL OR NOT public.has_capability(uid, 'stock.operate') THEN
      RAISE EXCEPTION 'Sem permissão para movimentar estoque.' USING errcode = '42501';
    END IF;
  END IF;
  IF _kind IN ('ajuste','inventario') AND NOT public.has_capability(uid, 'stock.adjust') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar estoque.' USING errcode = '42501';
  END IF;

  IF _from_location_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.locations WHERE id = _from_location_id AND is_blocked)
     AND NOT desbloqueado THEN
    RAISE EXCEPTION 'Peças bloqueadas só saem por liberação autorizada.' USING errcode = '42501';
  END IF;

  pode_custo := public.has_capability(uid, 'stock.cost.view');
  IF custo IS NOT NULL AND NOT pode_custo THEN
    custo := NULL; custo_descartado := true;
  END IF;
  IF custo IS NOT NULL AND custo < 0 THEN
    RAISE EXCEPTION 'O custo unitário não pode ser negativo.';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('stockmov:' || _idempotency_key, 0));
    SELECT id INTO mov FROM public.stock_movements WHERE idempotency_key = _idempotency_key;
    IF mov IS NOT NULL THEN RETURN mov; END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;
  IF _from_location_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.locations WHERE id = _from_location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de origem inexistente ou inativo.';
  END IF;
  IF _to_location_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.locations WHERE id = _to_location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de destino inexistente ou inativo.';
  END IF;

  IF _kind IN ('ajuste','inventario','saida') THEN
    IF nullif(trim(coalesce(_reason_code,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Informe o motivo desta operação.';
    END IF;
    SELECT true INTO motivo_ok FROM public.stock_reasons
      WHERE code = _reason_code AND is_active AND kind = _kind LIMIT 1;
    IF motivo_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'Motivo inválido para este tipo de movimentação.';
    END IF;
  END IF;

  IF (_kind = 'ajuste' OR coalesce(_reason_code,'') IN ('perda','avaria'))
     AND nullif(trim(coalesce(_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Escreva a justificativa desta operação.';
  END IF;

  IF _kind = 'entrada' AND coalesce(_reason_code,'') = 'compra'
     AND nullif(trim(coalesce(_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Informe a referência do recebimento (nota, pedido ou protocolo).';
  END IF;

  IF _quantity IS NULL THEN RAISE EXCEPTION 'Informe a quantidade.'; END IF;
  IF _kind = 'inventario' AND _quantity < 0 THEN
    RAISE EXCEPTION 'A contagem de inventário não pode ser negativa.';
  END IF;
  IF _kind = 'ajuste' AND _quantity = 0 THEN
    RAISE EXCEPTION 'O ajuste precisa ser diferente de zero.';
  END IF;
  IF _kind NOT IN ('inventario','ajuste') AND _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero.';
  END IF;

  a := least(coalesce(_from_location_id, _to_location_id), coalesce(_to_location_id, _from_location_id));
  b := greatest(coalesce(_from_location_id, _to_location_id), coalesce(_to_location_id, _from_location_id));
  PERFORM pg_advisory_xact_lock(hashtextextended(_variant_id::text || a::text, 0));
  IF b IS DISTINCT FROM a THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_variant_id::text || b::text, 0));
  END IF;

  PERFORM public.expire_reservations_internal(_variant_id, a);
  IF b IS DISTINCT FROM a THEN
    PERFORM public.expire_reservations_internal(_variant_id, b);
  END IF;

  SELECT quantity, reserved INTO fb, res_from FROM public.stock_balances
    WHERE variant_id = _variant_id AND location_id = _from_location_id FOR UPDATE;
  SELECT quantity, reserved INTO tb, res_to FROM public.stock_balances
    WHERE variant_id = _variant_id AND location_id = _to_location_id FOR UPDATE;
  IF _from_location_id IS NOT NULL THEN fb := coalesce(fb, 0); END IF;
  IF _to_location_id IS NOT NULL THEN tb := coalesce(tb, 0); END IF;
  res_from := coalesce(res_from, 0); res_to := coalesce(res_to, 0);

  IF _reservation_id IS NOT NULL THEN
    SELECT greatest(res_from - r.quantity, 0) INTO res_from
      FROM public.stock_reservations r
     WHERE r.id = _reservation_id AND r.variant_id = _variant_id
       AND r.location_id = _from_location_id;
    res_from := coalesce(res_from, 0);
  END IF;

  IF _kind = 'entrada' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de destino.'; END IF;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
  ELSIF _kind = 'saida' THEN
    IF _from_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de origem.'; END IF;
    livre := fb - res_from;
    IF _quantity > livre AND NOT desbloqueado THEN
      RAISE EXCEPTION 'Existem apenas % unidades disponíveis neste local (% reservadas).',
        greatest(livre,0), res_from;
    END IF;
    fa := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    saldo := fa;
  ELSIF _kind = 'transferencia' THEN
    IF _from_location_id IS NULL OR _to_location_id IS NULL THEN
      RAISE EXCEPTION 'Informe origem e destino.';
    END IF;
    IF _from_location_id = _to_location_id THEN
      RAISE EXCEPTION 'Origem e destino devem ser diferentes.';
    END IF;
    livre := fb - res_from;
    IF _quantity > livre AND NOT desbloqueado THEN
      RAISE EXCEPTION 'Existem apenas % unidades disponíveis neste local (% reservadas).',
        greatest(livre,0), res_from;
    END IF;
    fa := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
    IF _quantity > livre THEN
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (uid, 'stock.transfer.acima_do_disponivel', 'stock_movements', _variant_id::text,
        jsonb_build_object('quantidade', _quantity, 'disponivel', greatest(livre,0),
          'fisico_antes', fb, 'reservado', res_from, 'from', _from_location_id,
          'to', _to_location_id, 'referencia', _reference,
          'motivo', 'Estoque ainda não contado (peças na rua); saldo fica negativo até a contagem.'));
    END IF;
  ELSIF _kind = 'ajuste' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    IF tb + _quantity < res_to THEN
      RAISE EXCEPTION 'O ajuste deixaria o saldo abaixo das % unidades reservadas neste local.', res_to;
    END IF;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
  ELSIF _kind = 'inventario' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    SELECT COALESCE(quantity,0) INTO atual FROM public.stock_balances
      WHERE variant_id = _variant_id AND location_id = _to_location_id;
    IF _quantity < res_to THEN
      RAISE EXCEPTION 'A contagem informada é menor que as % unidades reservadas neste local.', res_to;
    END IF;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity - COALESCE(atual,0));
    saldo := ta;
  END IF;

  INSERT INTO public.stock_movements (
    kind, variant_id, from_location_id, to_location_id, quantity,
    unit_cost_cents, reason_code, reference, note, balance_after, created_by, idempotency_key,
    balance_from_before, balance_from_after, balance_to_before, balance_to_after, reservation_id
  ) VALUES (
    _kind, _variant_id, _from_location_id, _to_location_id, _quantity,
    custo, _reason_code, _reference, _note, saldo, uid, _idempotency_key,
    fb, fa, tb, ta, _reservation_id
  ) RETURNING id INTO mov;

  IF custo IS NOT NULL THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'stock.cost.informed', 'stock_movements', mov::text,
      jsonb_build_object('variant_id', _variant_id, 'unit_cost_cents', custo, 'kind', _kind));
  ELSIF custo_descartado THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'stock.cost.discarded', 'stock_movements', mov::text,
      jsonb_build_object('variant_id', _variant_id, 'motivo', 'sem capacidade stock.cost.view'));
  END IF;

  RETURN mov;
END $function$;

-- 2) kit_conferir: quando não há disponível, segue sem reserva (audita quantas ficaram sem).
CREATE OR REPLACE FUNCTION public.kit_conferir(_cycle uuid, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  res jsonb; validade timestamptz; total integer := 0;
  sem_reserva integer := 0; disp integer;
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
    disp := public.stock_available(it.variant_id, c.origin_location_id);
    IF disp >= it.quantity THEN
      res := public.create_stock_reservation(
        it.variant_id, c.origin_location_id, it.quantity, validade,
        'maleta', c.id::text, c.consultora_party_id,
        'Conferência da maleta', 'maleta-conf:' || comp.id::text || ':' || it.variant_id::text);
      UPDATE public.kit_composition_items
         SET reservation_id = (res->>'id')::uuid WHERE id = it.id;
    ELSE
      -- Estoque zerado/não contado: segue sem reserva, auditado no evento do ciclo.
      sem_reserva := sem_reserva + 1;
    END IF;
    total := total + it.quantity;
  END LOOP;

  UPDATE public.kit_compositions SET frozen_at = now(), frozen_by = uid, note = coalesce(_note, note)
   WHERE id = comp.id;
  UPDATE public.kit_cycles SET status = 'conferida', updated_by = uid WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload, reason)
  VALUES (_cycle, 'ciclo.conferido', c.status, 'conferida', uid,
          jsonb_build_object('composicao', comp.id, 'versao', comp.version, 'pecas', total,
            'itens_sem_reserva', sem_reserva,
            'motivo_sem_reserva', CASE WHEN sem_reserva > 0
              THEN 'Estoque ainda não contado (peças na rua); conferida sem reserva.' END), _note);

  RETURN jsonb_build_object('situacao','conferida','composition_id',comp.id,'pecas',total,
                            'itens_sem_reserva', sem_reserva);
END $function$;

-- 3) kit_expedir: liga o desbloqueio interno para a transferência depósito -> maleta.
CREATE OR REPLACE FUNCTION public.kit_expedir(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; comp public.kit_compositions; it record;
  loc uuid; destino uuid; rota text; transfer uuid; movimentos integer := 0; mov uuid;
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

  -- Desbloqueio interno: permite a transferência mesmo com estoque zerado
  -- (peças na rua, contagem pendente). Cada movimento acima do disponível é auditado.
  PERFORM set_config('lardan.stock_unblock', 'on', true);

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

  mov := public.kit_movement_open(_cycle, 'remessa_inicial', 'confirmado', NULL, destino,
    c.origin_location_id, loc, transfer, uid, nullif(_payload->>'note',''), NULL, NULL);
  UPDATE public.kit_movements SET composition_id = comp.id WHERE id = mov;

  INSERT INTO public.kit_movement_items (movement_id, variant_id, quantity, unit_reference_cents)
  SELECT mov, i.variant_id, i.quantity, i.unit_reference_cents
    FROM public.kit_composition_items i WHERE i.composition_id = comp.id;

  UPDATE public.kit_cycles
     SET status = 'transito', shipped_at = now(), custodian_party_id = NULL,
         current_location_id = loc, updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'ciclo.expedido', 'conferida', 'transito', uid,
          jsonb_build_object('rota', rota, 'destino', destino, 'transferencia', transfer,
                             'itens', movimentos, 'movimento', mov));

  RETURN jsonb_build_object('situacao','transito','rota',rota,'transfer_id',transfer,'itens',movimentos);
END $function$;
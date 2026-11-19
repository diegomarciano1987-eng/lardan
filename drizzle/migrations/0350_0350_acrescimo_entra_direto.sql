CREATE OR REPLACE FUNCTION public.kit_acrescimo_auto_receber(_movement uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE m public.kit_movements; c public.kit_cycles; it record; total integer := 0;
BEGIN
  SELECT * INTO m FROM public.kit_movements WHERE id = _movement FOR UPDATE;
  IF m.id IS NULL OR m.kind <> 'acrescimo' OR m.status <> 'pendente' THEN RETURN 0; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = m.cycle_id;
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
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = auth.uid(),
         confirmed_party_id = coalesce(c.custodian_party_id, c.consultora_party_id),
         confirmed_as = 'automatico', updated_at = now()
   WHERE id = m.id;
  IF m.transfer_id IS NOT NULL THEN
    UPDATE public.kit_transfers
       SET status = 'entregue', delivered_at = now(), updated_at = now()
     WHERE id = m.transfer_id;
  END IF;
  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.acrescimo.confirmado', auth.uid(),
          jsonb_build_object('movimento', m.id, 'quantidade', total, 'recebido_por', 'automatico'));
  RETURN total;
END $function$;
REVOKE ALL ON FUNCTION public.kit_acrescimo_auto_receber(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acrescimo_auto_receber(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.kit_acrescimo(_cycle uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  gerente boolean; c public.kit_cycles; loc uuid; origem uuid; destinatario uuid;
  mov uuid; transfer uuid; it jsonb; idx integer := 0; total integer := 0; n integer;
  idem text := nullif(_payload->>'idempotency_key','');
  hash text; existente public.kit_movements;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  IF _cycle IS NULL THEN RAISE EXCEPTION 'Informe a maleta.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;

  gerente := public.has_capability(uid, 'kit.manage') IS TRUE;
  IF NOT gerente THEN
    IF public.has_capability(uid, 'kit.acrescimo') IS NOT TRUE THEN
      RAISE EXCEPTION 'Sem permissão para acrescentar peças a maletas.' USING errcode='42501';
    END IF;
    IF eu IS NULL OR eu IS DISTINCT FROM c.representante_party_id THEN
      RAISE EXCEPTION 'Somente o representante vinculado a esta maleta pode acrescentar peças.'
        USING errcode='42501';
    END IF;
  END IF;

  IF c.status NOT IN ('transito','recebida','operacao') THEN
    RAISE EXCEPTION 'Só é possível acrescentar peças a uma maleta já expedida e ainda em operação.';
  END IF;
  IF jsonb_typeof(_payload->'itens') <> 'array' OR jsonb_array_length(_payload->'itens') = 0 THEN
    RAISE EXCEPTION 'Informe as peças do acréscimo.';
  END IF;

  origem := nullif(_payload->>'origem_location_id','')::uuid;
  IF origem IS NULL THEN origem := c.origin_location_id; END IF;
  IF origem IS NULL THEN RAISE EXCEPTION 'Escolha o depósito de origem do acréscimo.'; END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE id = origem AND (is_blocked OR NOT is_active)) THEN
    RAISE EXCEPTION 'Este depósito não pode fornecer peças para maletas.';
  END IF;
  IF NOT gerente AND NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = origem AND l.responsible_user_id = uid
  ) THEN
    RAISE EXCEPTION 'Sem permissão para retirar peças deste depósito.' USING errcode='42501';
  END IF;

  loc := public.kit_location_ensure(c.kit_id);
  destinatario := coalesce(c.custodian_party_id, c.consultora_party_id);
  hash := public.kit_idem_hash('acrescimo', _cycle, origem, loc, eu, destinatario, _payload->'itens');

  IF idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kitmov:' || idem, 0));
    SELECT * INTO existente FROM public.kit_movements WHERE idempotency_key = idem;
    IF existente.id IS NOT NULL THEN
      IF existente.payload_hash IS DISTINCT FROM hash THEN
        RAISE EXCEPTION 'Esta chave já foi usada para outra operação.' USING errcode='22023';
      END IF;
      PERFORM public.kit_require_cycle(existente.cycle_id);
      RETURN jsonb_build_object('movement_id', existente.id, 'repetida', true,
                                'situacao', existente.status);
    END IF;
  END IF;

  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'transito', eu, destinatario,
    origem, loc, nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO transfer;

  mov := public.kit_movement_open(_cycle, 'acrescimo', 'pendente', eu,
    destinatario, origem, loc, transfer, uid,
    nullif(_payload->>'note',''), idem, hash);

  PERFORM set_config('lardan.kit_stock', 'on', true);
  -- 0343/0344: equipe da Lardan (kit.manage), igual à expedição — estoque ainda não contado (peças na rua)
  -- não barra o acréscimo; o saldo fica negativo até a contagem e a saída acima do disponível é auditada.
  -- O representante continua limitado ao que existe no depósito dele.
  IF gerente THEN
    PERFORM set_config('lardan.stock_unblock', 'on', true);
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(_payload->'itens') LOOP
    idx := idx + 1;
    IF coalesce((it->>'quantity')::integer,0) <= 0 THEN
      RAISE EXCEPTION 'Quantidade inválida no item %.', idx;
    END IF;

    INSERT INTO public.kit_movement_items (movement_id, variant_id, quantity, unit_reference_cents, reason)
    VALUES (mov, (it->>'variant_id')::uuid, (it->>'quantity')::integer,
            nullif(it->>'unit_reference_cents','')::integer, nullif(it->>'reason',''));

    PERFORM public.register_stock_movement(
      'transferencia'::stock_move_kind, (it->>'variant_id')::uuid, (it->>'quantity')::integer,
      origem, loc, 'transferencia', NULL,
      'maleta:' || _cycle::text, 'Acréscimo de peças à maleta',
      'maleta-acr:' || mov::text || ':' || idx::text, NULL);

    INSERT INTO public.kit_balances (cycle_id, variant_id, qty_incoming)
    VALUES (_cycle, (it->>'variant_id')::uuid, (it->>'quantity')::integer)
    ON CONFLICT (cycle_id, variant_id)
    DO UPDATE SET qty_incoming = public.kit_balances.qty_incoming + excluded.qty_incoming,
                  updated_at = now();

    total := total + (it->>'quantity')::integer;
  END LOOP;
  PERFORM set_config('lardan.kit_stock', 'off', true);
  PERFORM set_config('lardan.stock_unblock', 'off', true);

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'maleta.acrescimo', uid,
    jsonb_build_object('movimento', mov, 'transferencia', transfer, 'itens', idx, 'quantidade', total,
                       'origem', origem, 'autor_pessoa', eu));

  -- 0350 (Diego, 19/11/2026): peça extra já foi para a consultora; entra direto na maleta,
  -- aceite automático, sem confirmação de nenhuma parte.
  PERFORM public.kit_acrescimo_auto_receber(mov);

  RETURN jsonb_build_object('movement_id', mov, 'transfer_id', transfer,
                            'itens', idx, 'quantidade', total, 'situacao','confirmado');
END $function$;

-- Acréscimos que ficaram "a caminho" também entram direto na maleta (mesma regra).
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.kit_movements WHERE kind = 'acrescimo' AND status = 'pendente' LOOP
    PERFORM public.kit_acrescimo_auto_receber(r.id);
  END LOOP;
END $$;
-- ============================================================
-- Integridade das movimentações de maleta
-- ============================================================

-- 1. Local bloqueado (garantia / defeito) -----------------------------------
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;

-- 2. Colunas de conferência real --------------------------------------------
ALTER TABLE public.kit_movement_items
  ADD COLUMN IF NOT EXISTS qty_received integer,
  ADD COLUMN IF NOT EXISTS qty_approved integer,
  ADD COLUMN IF NOT EXISTS qty_conf_divergent integer,
  ADD COLUMN IF NOT EXISTS conference_reason text;

ALTER TABLE public.kit_movements
  ADD COLUMN IF NOT EXISTS confirmed_party_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_as text;

ALTER TABLE public.kit_balances
  ADD COLUMN IF NOT EXISTS qty_return_divergent integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS kit_movements_idem_uidx
  ON public.kit_movements (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Capacidades específicas -------------------------------------------------
INSERT INTO public.role_capabilities (role, capability)
SELECT r, c FROM (VALUES
  ('master','kit.acrescimo'),('diretoria','kit.acrescimo'),
  ('estoque','kit.acrescimo'),('representante','kit.acrescimo'),
  ('master','stock.unblock'),('diretoria','stock.unblock'),
  ('estoque','stock.unblock'),('qualidade','stock.unblock')
) v(r0,c), LATERAL (SELECT v.r0::public.app_role) x(r)
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_capabilities rc WHERE rc.role = x.r AND rc.capability = v.c
);

-- 4. Local bloqueado oficial -------------------------------------------------
CREATE OR REPLACE FUNCTION public.kit_blocked_location()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE loc uuid;
BEGIN
  SELECT id INTO loc FROM public.locations WHERE code = 'BLOQ-QUALIDADE';
  IF loc IS NULL THEN
    INSERT INTO public.locations (code, name, kind, notes, is_active, is_blocked)
    VALUES ('BLOQ-QUALIDADE', 'Bloqueado — garantia e defeito', 'outro',
            'Peças em garantia ou com defeito. Indisponíveis para novas maletas.', true, true)
    RETURNING id INTO loc;
  ELSE
    UPDATE public.locations SET is_blocked = true, is_active = true
     WHERE id = loc AND (is_blocked IS NOT TRUE OR is_active IS NOT TRUE);
  END IF;
  RETURN loc;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.kit_blocked_location() FROM PUBLIC, anon, authenticated;

-- 5. Assinatura canônica da operação ----------------------------------------
CREATE OR REPLACE FUNCTION public.kit_idem_hash(
  _kind text, _cycle uuid, _from_loc uuid, _to_loc uuid,
  _from_party uuid, _to_party uuid, _itens jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $fn$
  SELECT md5(jsonb_build_object(
    'kind', _kind,
    'cycle', _cycle::text,
    'from_loc', coalesce(_from_loc::text,''),
    'to_loc', coalesce(_to_loc::text,''),
    'from_party', coalesce(_from_party::text,''),
    'to_party', coalesce(_to_party::text,''),
    'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'v', coalesce(x->>'variant_id',''),
               'q', coalesce(x->>'quantity',''),
               'd', coalesce(x->>'destino',''),
               'r', coalesce(x->>'reason',''))
             ORDER BY coalesce(x->>'variant_id','') || '|' || coalesce(x->>'destino','')
                      || '|' || coalesce(x->>'quantity',''))
      FROM jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) x), '[]'::jsonb)
  )::text)
$fn$;

REVOKE EXECUTE ON FUNCTION public.kit_idem_hash(text,uuid,uuid,uuid,uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated;

-- 6. Estoque: chamada interna das rotinas de maleta + origem bloqueada -------
CREATE OR REPLACE FUNCTION public.register_stock_movement(
  _kind stock_move_kind, _variant_id uuid, _quantity integer,
  _from_location_id uuid DEFAULT NULL::uuid, _to_location_id uuid DEFAULT NULL::uuid,
  _reason_code text DEFAULT NULL::text, _unit_cost_cents integer DEFAULT NULL::integer,
  _reference text DEFAULT NULL::text, _note text DEFAULT NULL::text,
  _idempotency_key text DEFAULT NULL::text, _reservation_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  uid uuid := auth.uid();
  saldo integer; mov uuid; atual integer;
  a uuid; b uuid; motivo_ok boolean;
  pode_custo boolean;
  custo integer := _unit_cost_cents;
  custo_descartado boolean := false;
  fb integer; fa integer; tb integer; ta integer;
  res_from integer := 0; res_to integer := 0; livre integer;
  interno boolean := coalesce(current_setting('lardan.kit_stock', true), '') = 'on';
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
     AND coalesce(current_setting('lardan.stock_unblock', true), '') <> 'on' THEN
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
    IF _quantity > livre THEN
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
    IF _quantity > livre THEN
      RAISE EXCEPTION 'Existem apenas % unidades disponíveis neste local (% reservadas).',
        greatest(livre,0), res_from;
    END IF;
    fa := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
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
END $fn$;

-- 7. Liberação auditável de peças bloqueadas ---------------------------------
CREATE OR REPLACE FUNCTION public.stock_liberar_bloqueio(
  _variant_id uuid, _quantity integer, _to_location_id uuid, _motivo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE uid uuid := auth.uid(); origem uuid; mov uuid;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'stock.unblock') THEN
    RAISE EXCEPTION 'Sem permissão para liberar peças bloqueadas.' USING errcode='42501';
  END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Escreva o motivo da liberação.';
  END IF;
  IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Escolha o depósito de destino.'; END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE id = _to_location_id AND is_blocked) THEN
    RAISE EXCEPTION 'O destino da liberação não pode ser outro local bloqueado.';
  END IF;

  origem := public.kit_blocked_location();
  PERFORM set_config('lardan.stock_unblock', 'on', true);
  mov := public.register_stock_movement(
    'transferencia'::stock_move_kind, _variant_id, _quantity, origem, _to_location_id,
    'transferencia', NULL, 'liberacao-bloqueio', _motivo, NULL, NULL);
  PERFORM set_config('lardan.stock_unblock', 'off', true);

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'stock.unblock', 'stock_movements', mov::text,
          jsonb_build_object('variant_id', _variant_id, 'quantidade', _quantity,
                             'destino', _to_location_id, 'motivo', _motivo));
  RETURN mov;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.stock_liberar_bloqueio(uuid,integer,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_liberar_bloqueio(uuid,integer,uuid,text) TO authenticated;

-- 8. Acréscimo: autorização específica + assinatura completa -----------------
CREATE OR REPLACE FUNCTION public.kit_acrescimo(_cycle uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
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

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'maleta.acrescimo', uid,
    jsonb_build_object('movimento', mov, 'transferencia', transfer, 'itens', idx, 'quantidade', total,
                       'origem', origem, 'autor_pessoa', eu));

  RETURN jsonb_build_object('movement_id', mov, 'transfer_id', transfer,
                            'itens', idx, 'quantidade', total, 'situacao','pendente');
END $fn$;

-- 9. Confirmação do acréscimo: distingue quem recebeu ------------------------
CREATE OR REPLACE FUNCTION public.kit_acrescimo_confirmar(_movement uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  m public.kit_movements; c public.kit_cycles; it record; total integer := 0; papel text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO m FROM public.kit_movements WHERE id = _movement FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Movimentação não encontrada.'; END IF;
  IF m.kind <> 'acrescimo' THEN RAISE EXCEPTION 'Esta movimentação não é um acréscimo.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = m.cycle_id FOR UPDATE;
  IF eu IS NOT NULL AND eu = c.consultora_party_id THEN papel := 'consultora';
  ELSIF eu IS NOT NULL AND eu = c.representante_party_id THEN papel := 'representante';
  ELSIF public.has_capability(uid,'kit.manage') IS TRUE THEN papel := 'matriz';
  END IF;

  IF papel IS NULL
     OR (papel <> 'matriz'
         AND eu IS DISTINCT FROM coalesce(c.custodian_party_id, c.consultora_party_id)) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode confirmar o recebimento.' USING errcode='42501';
  END IF;

  IF m.status = 'confirmado' THEN
    RETURN jsonb_build_object('movement_id', m.id, 'repetida', true, 'situacao','confirmado',
                              'recebido_por', m.confirmed_as);
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
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = uid,
         confirmed_party_id = eu, confirmed_as = papel, updated_at = now()
   WHERE id = m.id;

  IF m.transfer_id IS NOT NULL THEN
    UPDATE public.kit_transfers
       SET status = 'entregue', delivered_at = now(), updated_by = uid, updated_at = now()
     WHERE id = m.transfer_id;
  END IF;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.acrescimo.confirmado', uid,
          jsonb_build_object('movimento', m.id, 'quantidade', total, 'recebido_por', papel));

  RETURN jsonb_build_object('movement_id', m.id, 'situacao','confirmado',
                            'quantidade', total, 'recebido_por', papel);
END $fn$;

-- 10. Retorno: autoriza antes de responder e assina a operação inteira -------
CREATE OR REPLACE FUNCTION public.kit_retorno(_cycle uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  uid uuid := auth.uid(); eu uuid := public.my_party_id();
  c public.kit_cycles; loc uuid; mov uuid; it jsonb; idx integer := 0;
  destino text; qtd integer; disponivel integer; total integer := 0;
  idem text := nullif(_payload->>'idempotency_key','');
  hash text; existente public.kit_movements;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;

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
  hash := public.kit_idem_hash('retorno', _cycle, loc, c.origin_location_id,
                               coalesce(c.custodian_party_id, c.consultora_party_id), NULL,
                               _payload->'itens');

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
           - qty_retained - qty_warranty - qty_lost - qty_return_divergent
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
END $fn$;

-- 11. Conferência real da Matriz ---------------------------------------------
CREATE OR REPLACE FUNCTION public.kit_retorno_confirmar(_movement uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  uid uuid := public.kit_require_manage();
  m public.kit_movements; c public.kit_cycles; it record; conf jsonb;
  loc uuid; destino_loc uuid; bloqueado uuid;
  idx integer := 0; recebidas integer := 0; aprovadas integer := 0;
  divergentes integer := 0; faltantes integer := 0; perdidas integer := 0;
  q_rec integer; q_apr integer; q_div integer; motivo text;
BEGIN
  SELECT * INTO m FROM public.kit_movements WHERE id = _movement FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Movimentação não encontrada.'; END IF;
  IF m.kind <> 'retorno' THEN RAISE EXCEPTION 'Esta movimentação não é um retorno.'; END IF;
  PERFORM public.kit_require_cycle(m.cycle_id);
  IF m.status = 'confirmado' THEN
    RETURN jsonb_build_object('movement_id', m.id, 'repetida', true, 'situacao','confirmado');
  END IF;
  IF m.status = 'cancelado' THEN RAISE EXCEPTION 'Retorno cancelado.'; END IF;

  SELECT * INTO c FROM public.kit_cycles WHERE id = m.cycle_id FOR UPDATE;
  loc := public.kit_location_ensure(c.kit_id);
  destino_loc := coalesce(nullif(_payload->>'destino_location_id','')::uuid, c.origin_location_id);
  IF destino_loc IS NULL THEN RAISE EXCEPTION 'Escolha o depósito que recebe o retorno.'; END IF;
  IF EXISTS (SELECT 1 FROM public.locations WHERE id = destino_loc AND is_blocked) THEN
    RAISE EXCEPTION 'O retorno aprovado não pode ser recebido em local bloqueado.';
  END IF;
  bloqueado := public.kit_blocked_location();

  PERFORM set_config('lardan.kit_stock', 'on', true);
  FOR it IN SELECT * FROM public.kit_movement_items WHERE movement_id = m.id ORDER BY created_at LOOP
    idx := idx + 1;

    IF it.destino = 'perda' THEN
      PERFORM public.register_stock_movement(
        'saida'::stock_move_kind, it.variant_id, it.quantity,
        loc, NULL, 'perda', NULL,
        'maleta:' || m.cycle_id::text, 'Perda declarada no retorno da maleta',
        'maleta-perda:' || m.id::text || ':' || idx::text, NULL);
      perdidas := perdidas + it.quantity;
      CONTINUE;
    END IF;

    IF it.destino = 'mantida' THEN CONTINUE; END IF;

    SELECT x INTO conf
      FROM jsonb_array_elements(coalesce(_payload->'itens','[]'::jsonb)) x
     WHERE (x->>'item_id')::uuid = it.id
     LIMIT 1;
    IF conf IS NULL THEN
      RAISE EXCEPTION 'Informe a conferência de todas as peças declaradas (item %).', idx;
    END IF;

    q_rec := coalesce((conf->>'qty_recebida')::integer, -1);
    q_apr := coalesce((conf->>'qty_aprovada')::integer, -1);
    q_div := coalesce((conf->>'qty_divergente')::integer, 0);
    motivo := nullif(conf->>'motivo','');

    IF q_rec < 0 OR q_apr < 0 OR q_div < 0 THEN
      RAISE EXCEPTION 'Item %: quantidades da conferência inválidas.', idx;
    END IF;
    IF q_rec > it.quantity THEN
      RAISE EXCEPTION 'Item %: recebido (%) é maior do que o declarado (%).', idx, q_rec, it.quantity;
    END IF;
    IF q_apr + q_div <> q_rec THEN
      RAISE EXCEPTION 'Item %: aprovado mais divergente precisa somar exatamente o recebido.', idx;
    END IF;
    IF (q_div > 0 OR q_rec < it.quantity) AND motivo IS NULL THEN
      RAISE EXCEPTION 'Item %: escreva o motivo da diferença.', idx;
    END IF;

    -- peças aprovadas: garantia vai para o local bloqueado; retorno vai ao depósito
    IF q_apr > 0 THEN
      PERFORM public.register_stock_movement(
        'transferencia'::stock_move_kind, it.variant_id, q_apr,
        loc, CASE WHEN it.destino = 'garantia' THEN bloqueado ELSE destino_loc END,
        'transferencia', NULL,
        'maleta:' || m.cycle_id::text,
        CASE WHEN it.destino = 'garantia'
             THEN 'Retorno em garantia — bloqueado para análise'
             ELSE 'Retorno da maleta conferido' END,
        'maleta-ret:' || m.id::text || ':' || idx::text, NULL);
    END IF;

    -- peças recebidas com defeito: sempre bloqueadas
    IF q_div > 0 THEN
      PERFORM public.register_stock_movement(
        'transferencia'::stock_move_kind, it.variant_id, q_div,
        loc, bloqueado, 'transferencia', NULL,
        'maleta:' || m.cycle_id::text, 'Divergência na conferência — bloqueado',
        'maleta-ret-div:' || m.id::text || ':' || idx::text, NULL);
    END IF;

    UPDATE public.kit_balances
       SET qty_return_transit = greatest(qty_return_transit - it.quantity, 0),
           qty_returned = qty_returned + CASE WHEN it.destino = 'retorno' THEN q_apr ELSE 0 END,
           qty_warranty = qty_warranty + CASE WHEN it.destino = 'garantia' THEN q_apr ELSE 0 END,
           qty_return_divergent = qty_return_divergent + q_div,
           updated_at = now()
     WHERE cycle_id = m.cycle_id AND variant_id = it.variant_id;

    UPDATE public.kit_movement_items
       SET qty_received = q_rec, qty_approved = q_apr,
           qty_conf_divergent = q_div, conference_reason = motivo
     WHERE id = it.id;

    recebidas := recebidas + q_rec;
    aprovadas := aprovadas + q_apr;
    divergentes := divergentes + q_div;
    faltantes := faltantes + (it.quantity - q_rec);
  END LOOP;
  PERFORM set_config('lardan.kit_stock', 'off', true);

  UPDATE public.kit_movements
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = uid,
         confirmed_party_id = public.my_party_id(), confirmed_as = 'matriz',
         to_location_id = destino_loc, updated_at = now()
   WHERE id = m.id;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.retorno.confirmado', uid,
          jsonb_build_object('movimento', m.id, 'itens', idx, 'recebidas', recebidas,
                             'aprovadas', aprovadas, 'divergentes', divergentes,
                             'faltantes', faltantes, 'perdas', perdidas, 'deposito', destino_loc));

  RETURN jsonb_build_object('movement_id', m.id, 'situacao','confirmado', 'itens', idx,
    'recebidas', recebidas, 'aprovadas', aprovadas, 'divergentes', divergentes,
    'faltantes', faltantes, 'perdas', perdidas,
    'aviso', CASE WHEN faltantes > 0
                  THEN 'As peças declaradas e não recebidas continuam a explicar. Não viraram venda nem dívida.'
             END);
END $fn$;

-- 12. Conferência por produto inclui a divergência de retorno ----------------
CREATE OR REPLACE FUNCTION public.kit_conciliacao(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
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
           b.qty_return_divergent AS divergencia,
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
           'garantia', garantia, 'divergencia', divergencia,
           'perda', perda, 'mantida', mantida,
           'vendido', vendido, 'a_caminho', a_caminho,
           'sob_responsabilidade', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido,
           'a_explicar', (enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido
         ) ORDER BY variant_id), '[]'::jsonb),
         jsonb_build_object(
           'saiu', coalesce(sum(enviado + acrescido),0),
           'aceito', coalesce(sum(aceito),0),
           'retornado', coalesce(sum(retornado),0),
           'retorno_em_transito', coalesce(sum(retorno_em_transito),0),
           'garantia', coalesce(sum(garantia),0),
           'divergencia', coalesce(sum(divergencia),0),
           'perda', coalesce(sum(perda),0),
           'mantida', coalesce(sum(mantida),0),
           'vendido', coalesce(sum(vendido),0),
           'a_caminho', coalesce(sum(a_caminho),0),
           'a_explicar', coalesce(sum((enviado + acrescido)
             - retornado - retorno_em_transito - garantia - divergencia - perda - mantida - vendido),0))
    INTO linhas, tot
  FROM base;

  RETURN jsonb_build_object(
    'linhas', linhas,
    'totais', tot,
    'vendas_disponiveis', false,
    'aviso', 'Peças ainda sob responsabilidade não são venda nem dívida. As vendas da consultora ainda não alimentam esta conferência.');
END $fn$;

-- 13. Histórico com a conferência ------------------------------------------
CREATE OR REPLACE FUNCTION public.kit_historico(_cycle uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r jsonb;
BEGIN
  PERFORM public.kit_require_cycle(_cycle);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'seq'), '[]'::jsonb) INTO r
  FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'seq', m.seq, 'tipo', m.kind, 'situacao', m.status,
      'quando', m.occurred_at, 'confirmado_em', m.confirmed_at,
      'confirmado_por', m.confirmed_as,
      'de_pessoa', m.from_party_id, 'para_pessoa', m.to_party_id,
      'de_local', m.from_location_id, 'para_local', m.to_location_id,
      'observacao', m.note,
      'itens', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'variant_id', i.variant_id, 'quantidade', i.quantity,
          'destino', i.destino, 'motivo', i.reason,
          'recebida', i.qty_received, 'aprovada', i.qty_approved,
          'divergente', i.qty_conf_divergent, 'motivo_conferencia', i.conference_reason))
        FROM public.kit_movement_items i WHERE i.movement_id = m.id), '[]'::jsonb)
    ) AS x
    FROM public.kit_movements m WHERE m.cycle_id = _cycle
  ) s;
  RETURN jsonb_build_object('movimentos', r);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.kit_acrescimo(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_acrescimo_confirmar(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_retorno(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_retorno_confirmar(uuid,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_conciliacao(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.kit_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_acrescimo(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_acrescimo_confirmar(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_retorno(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_retorno_confirmar(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_conciliacao(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kit_historico(uuid) TO authenticated;
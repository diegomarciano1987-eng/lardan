-- ============================================================
-- Maletas: histórico de movimentações (remessa, acréscimo,
-- transferência, retorno, mantidas, garantia, perda)
-- ============================================================

ALTER TABLE public.kit_balances
  ADD COLUMN IF NOT EXISTS qty_incoming integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.kit_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.kit_cycles(id) ON DELETE CASCADE,
  kit_id uuid NOT NULL REFERENCES public.kits(id),
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('remessa_inicial','acrescimo','transferencia','retorno','mantida','garantia','perda','venda','divergencia')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','cancelado')),
  from_party_id uuid REFERENCES public.parties(id),
  to_party_id uuid REFERENCES public.parties(id),
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  transfer_id uuid REFERENCES public.kit_transfers(id),
  composition_id uuid REFERENCES public.kit_compositions(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by uuid,
  actor_user_id uuid,
  note text,
  idempotency_key text,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS kit_movements_idem_uidx
  ON public.kit_movements (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS kit_movements_cycle_idx ON public.kit_movements (cycle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS kit_movements_kit_idx ON public.kit_movements (kit_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.kit_movement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES public.kit_movements(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  destino text CHECK (destino IN ('retorno','garantia','perda','mantida')),
  unit_reference_cents integer,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kit_movement_items_mov_idx ON public.kit_movement_items (movement_id);
CREATE INDEX IF NOT EXISTS kit_movement_items_variant_idx ON public.kit_movement_items (variant_id);

GRANT SELECT ON public.kit_movements TO authenticated;
GRANT SELECT ON public.kit_movement_items TO authenticated;
GRANT ALL ON public.kit_movements TO service_role;
GRANT ALL ON public.kit_movement_items TO service_role;

ALTER TABLE public.kit_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_movement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kit_movements_scope_select" ON public.kit_movements;
CREATE POLICY "kit_movements_scope_select" ON public.kit_movements
  FOR SELECT TO authenticated
  USING (public.kit_cycle_in_scope(cycle_id) IS TRUE);

DROP POLICY IF EXISTS "kit_movement_items_scope_select" ON public.kit_movement_items;
CREATE POLICY "kit_movement_items_scope_select" ON public.kit_movement_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.kit_movements m
     WHERE m.id = kit_movement_items.movement_id
       AND public.kit_cycle_in_scope(m.cycle_id) IS TRUE
  ));

DROP TRIGGER IF EXISTS zz_block_direct_write ON public.kit_movements;
CREATE TRIGGER zz_block_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.kit_movements
  FOR EACH ROW EXECUTE FUNCTION public.kit_block_direct_write();

DROP TRIGGER IF EXISTS zz_block_direct_write ON public.kit_movement_items;
CREATE TRIGGER zz_block_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.kit_movement_items
  FOR EACH ROW EXECUTE FUNCTION public.kit_block_direct_write();

-- ============================================================
-- Helper interno: cria o cabeçalho da movimentação
-- ============================================================
CREATE OR REPLACE FUNCTION public.kit_movement_open(
  _cycle uuid, _kind text, _status text,
  _from_party uuid, _to_party uuid,
  _from_loc uuid, _to_loc uuid,
  _transfer uuid, _actor uuid, _note text, _idem text, _hash text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer; novo uuid; k uuid;
BEGIN
  SELECT kit_id INTO k FROM public.kit_cycles WHERE id = _cycle;
  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_movements WHERE cycle_id = _cycle;
  INSERT INTO public.kit_movements (cycle_id, kit_id, seq, kind, status, from_party_id, to_party_id,
    from_location_id, to_location_id, transfer_id, actor_user_id, note, idempotency_key, payload_hash,
    confirmed_at, confirmed_by)
  VALUES (_cycle, k, n, _kind, _status, _from_party, _to_party, _from_loc, _to_loc, _transfer,
    _actor, _note, _idem, _hash,
    CASE WHEN _status = 'confirmado' THEN now() END,
    CASE WHEN _status = 'confirmado' THEN _actor END)
  RETURNING id INTO novo;
  RETURN novo;
END $$;

REVOKE ALL ON FUNCTION public.kit_movement_open(uuid,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- Acréscimo de peças a uma maleta em campo
-- ============================================================
CREATE OR REPLACE FUNCTION public.kit_acrescimo(_cycle uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  c public.kit_cycles; loc uuid; origem uuid; mov uuid; transfer uuid;
  it jsonb; idx integer := 0; total integer := 0; n integer;
  idem text := nullif(_payload->>'idempotency_key','');
  hash text := md5(coalesce(_payload->'itens','[]'::jsonb)::text);
  existente public.kit_movements;
BEGIN
  IF _cycle IS NULL THEN RAISE EXCEPTION 'Informe a maleta.'; END IF;

  IF idem IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kitacr:' || idem, 0));
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
  IF c.status NOT IN ('transito','recebida','operacao') THEN
    RAISE EXCEPTION 'Só é possível acrescentar peças a uma maleta já expedida e ainda em operação.';
  END IF;
  IF jsonb_typeof(_payload->'itens') <> 'array' OR jsonb_array_length(_payload->'itens') = 0 THEN
    RAISE EXCEPTION 'Informe as peças do acréscimo.';
  END IF;

  origem := nullif(_payload->>'origem_location_id','')::uuid;
  IF origem IS NULL THEN origem := c.origin_location_id; END IF;
  IF origem IS NULL THEN RAISE EXCEPTION 'Escolha o depósito de origem do acréscimo.'; END IF;

  loc := public.kit_location_ensure(c.kit_id);

  SELECT coalesce(max(seq),0) + 1 INTO n FROM public.kit_transfers WHERE cycle_id = _cycle;
  INSERT INTO public.kit_transfers (cycle_id, seq, status, from_party_id, to_party_id,
    from_location_id, to_location_id, carrier, tracking_code, shipped_at, note, created_by, updated_by)
  VALUES (_cycle, n, 'transito', NULL, coalesce(c.custodian_party_id, c.consultora_party_id),
    origem, loc, nullif(_payload->>'carrier',''), nullif(_payload->>'tracking_code',''), now(),
    nullif(_payload->>'note',''), uid, uid)
  RETURNING id INTO transfer;

  mov := public.kit_movement_open(_cycle, 'acrescimo', 'pendente', NULL,
    coalesce(c.custodian_party_id, c.consultora_party_id), origem, loc, transfer, uid,
    nullif(_payload->>'note',''), idem, hash);

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

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'maleta.acrescimo', uid,
    jsonb_build_object('movimento', mov, 'transferencia', transfer, 'itens', idx, 'quantidade', total,
                       'origem', origem));

  RETURN jsonb_build_object('movement_id', mov, 'transfer_id', transfer,
                            'itens', idx, 'quantidade', total, 'situacao','pendente');
END $$;

REVOKE ALL ON FUNCTION public.kit_acrescimo(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_acrescimo(uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- Confirmação de recebimento do acréscimo
-- ============================================================
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

REVOKE ALL ON FUNCTION public.kit_acrescimo_confirmar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_acrescimo_confirmar(uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- Retorno de peças (retorno, garantia, perda, mantida)
-- ============================================================
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

    SELECT qty_allocated - qty_returned - qty_return_transit - qty_retained
           - qty_warranty - qty_lost - qty_sold
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

REVOKE ALL ON FUNCTION public.kit_retorno(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_retorno(uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- Confirmação do retorno físico na Matriz
-- ============================================================
CREATE OR REPLACE FUNCTION public.kit_retorno_confirmar(_movement uuid, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := public.kit_require_manage();
  m public.kit_movements; c public.kit_cycles; it record;
  loc uuid; destino_loc uuid; idx integer := 0; total integer := 0;
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

  FOR it IN SELECT * FROM public.kit_movement_items WHERE movement_id = m.id
             AND destino IN ('retorno','garantia') ORDER BY created_at LOOP
    idx := idx + 1;
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
  END LOOP;

  UPDATE public.kit_movements
     SET status = 'confirmado', confirmed_at = now(), confirmed_by = uid,
         to_location_id = destino_loc, updated_at = now()
   WHERE id = m.id;

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (m.cycle_id, 'maleta.retorno.confirmado', uid,
          jsonb_build_object('movimento', m.id, 'itens', idx, 'quantidade', total,
                             'deposito', destino_loc));

  RETURN jsonb_build_object('movement_id', m.id, 'situacao','confirmado',
                            'itens', idx, 'quantidade', total);
END $$;

REVOKE ALL ON FUNCTION public.kit_retorno_confirmar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_retorno_confirmar(uuid, jsonb) TO authenticated, service_role;

-- ============================================================
-- Histórico da maleta
-- ============================================================
CREATE OR REPLACE FUNCTION public.kit_historico(_cycle uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r jsonb;
BEGIN
  PERFORM public.kit_require_cycle(_cycle);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'seq'), '[]'::jsonb) INTO r
  FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'seq', m.seq, 'tipo', m.kind, 'situacao', m.status,
      'quando', m.occurred_at, 'confirmado_em', m.confirmed_at,
      'de_pessoa', m.from_party_id, 'para_pessoa', m.to_party_id,
      'de_local', m.from_location_id, 'para_local', m.to_location_id,
      'observacao', m.note,
      'itens', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'variant_id', i.variant_id, 'quantidade', i.quantity,
          'destino', i.destino, 'motivo', i.reason))
        FROM public.kit_movement_items i WHERE i.movement_id = m.id), '[]'::jsonb)
    ) AS x
    FROM public.kit_movements m WHERE m.cycle_id = _cycle
  ) s;
  RETURN jsonb_build_object('movimentos', r);
END $$;

REVOKE ALL ON FUNCTION public.kit_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_historico(uuid) TO authenticated, service_role;

-- ============================================================
-- Conferência: confronto por produto
-- ============================================================
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
           'enviado', enviado, 'acrescido', acrescido,
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

REVOKE ALL ON FUNCTION public.kit_conciliacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kit_conciliacao(uuid) TO authenticated, service_role;

-- ============================================================
-- Expedição e encaminhamento passam a alimentar o histórico
-- ============================================================
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
     SET status = 'transito', shipped_at = now(), custodian_party_id = destino,
         current_location_id = loc, updated_by = uid
   WHERE id = _cycle;

  INSERT INTO public.kit_events (cycle_id, kind, from_status, to_status, actor_user_id, payload)
  VALUES (_cycle, 'ciclo.expedido', 'conferida', 'transito', uid,
          jsonb_build_object('rota', rota, 'destino', destino, 'transferencia', transfer,
                             'itens', movimentos, 'movimento', mov));

  RETURN jsonb_build_object('situacao','transito','rota',rota,'transfer_id',transfer,'itens',movimentos);
END $function$;

CREATE OR REPLACE FUNCTION public.kit_transfer_forward(_cycle uuid, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid(); c public.kit_cycles; eu uuid := public.my_party_id();
  n integer; novo uuid; mov uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Faça login.' USING errcode='42501'; END IF;
  SELECT * INTO c FROM public.kit_cycles WHERE id = _cycle FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Ciclo de maleta não encontrado.'; END IF;
  IF public.has_capability(uid,'kit.manage') IS NOT TRUE
     AND (eu IS NULL OR c.custodian_party_id IS DISTINCT FROM eu) THEN
    RAISE EXCEPTION 'Somente quem está com a maleta pode encaminhá-la.' USING errcode='42501';
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

  mov := public.kit_movement_open(_cycle, 'transferencia', 'confirmado',
    c.custodian_party_id, c.consultora_party_id, c.current_location_id, c.current_location_id,
    novo, uid, nullif(_payload->>'note',''), NULL, NULL);

  INSERT INTO public.kit_events (cycle_id, kind, actor_user_id, payload)
  VALUES (_cycle, 'entrega.encaminhada', uid,
          jsonb_build_object('transferencia', novo, 'de', c.custodian_party_id,
                             'para', c.consultora_party_id, 'movimento', mov));

  RETURN jsonb_build_object('transfer_id', novo, 'situacao','transito');
END $function$;
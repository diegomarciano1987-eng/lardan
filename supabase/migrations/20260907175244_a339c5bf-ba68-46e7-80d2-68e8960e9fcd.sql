-- ============================================================
-- LARDAN Cloud — Motor real de reservas de estoque
-- físico = stock_balances.quantity
-- reservado = stock_balances.reserved (somente reservas ativas)
-- disponível = físico - reservado
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.stock_reservation_status AS ENUM
    ('ativa','confirmada','liberada','vencida','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.stock_reservation_protocol_seq;

CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol text NOT NULL UNIQUE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status public.stock_reservation_status NOT NULL DEFAULT 'ativa',
  origin text NOT NULL DEFAULT 'manual',
  external_reference text,
  party_id uuid REFERENCES public.parties(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.profiles(id),
  released_at timestamptz,
  released_by uuid REFERENCES public.profiles(id),
  cancel_reason text,
  movement_id uuid REFERENCES public.stock_movements(id),
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS stock_reservations_ativa_idx
  ON public.stock_reservations (variant_id, location_id) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS stock_reservations_status_idx
  ON public.stock_reservations (status, expires_at);
CREATE INDEX IF NOT EXISTS stock_reservations_created_idx
  ON public.stock_reservations (created_at DESC);

GRANT SELECT ON public.stock_reservations TO authenticated;
GRANT ALL ON public.stock_reservations TO service_role;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_reservations_read ON public.stock_reservations;
CREATE POLICY stock_reservations_read ON public.stock_reservations
  FOR SELECT TO authenticated
  USING (public.has_capability(auth.uid(), 'stock.reservation.view'));

CREATE OR REPLACE FUNCTION public.stock_reservations_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Reservas não podem ser excluídas; use liberar ou cancelar.';
END $$;

DROP TRIGGER IF EXISTS stock_reservations_no_delete ON public.stock_reservations;
CREATE TRIGGER stock_reservations_no_delete BEFORE DELETE ON public.stock_reservations
  FOR EACH ROW EXECUTE FUNCTION public.stock_reservations_no_delete();

UPDATE public.stock_balances SET reserved = 0 WHERE reserved IS NULL OR reserved < 0;
DO $$ BEGIN
  ALTER TABLE public.stock_balances
    ADD CONSTRAINT stock_balances_reserved_nonneg CHECK (reserved >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.stock_reservations(id);

INSERT INTO public.role_capabilities (role, capability) VALUES
  ('master','stock.reservation.view'),
  ('master','stock.reservation.create'),
  ('master','stock.reservation.confirm'),
  ('master','stock.reservation.cancel'),
  ('master','stock.reservation.expire'),
  ('master','stock.reservation.audit'),
  ('diretoria','stock.reservation.view'),
  ('diretoria','stock.reservation.create'),
  ('diretoria','stock.reservation.confirm'),
  ('diretoria','stock.reservation.cancel'),
  ('diretoria','stock.reservation.expire'),
  ('diretoria','stock.reservation.audit'),
  ('estoque','stock.reservation.view'),
  ('estoque','stock.reservation.create'),
  ('estoque','stock.reservation.confirm'),
  ('estoque','stock.reservation.cancel'),
  ('financeiro','stock.reservation.view')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.expire_reservations_internal(
  _variant uuid DEFAULT NULL, _location uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.stock_reservations
     WHERE status = 'ativa' AND expires_at <= now()
       AND (_variant IS NULL OR variant_id = _variant)
       AND (_location IS NULL OR location_id = _location)
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.stock_reservations
       SET status = 'vencida', released_at = now()
     WHERE id = r.id AND status = 'ativa';
    IF FOUND THEN
      UPDATE public.stock_balances
         SET reserved = greatest(reserved - r.quantity, 0), updated_at = now()
       WHERE variant_id = r.variant_id AND location_id = r.location_id;
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (NULL, 'stock.reservation.expired', 'stock_reservations', r.id::text,
        jsonb_build_object('protocolo', r.protocol, 'quantidade', r.quantity,
                           'variant_id', r.variant_id, 'location_id', r.location_id));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.expire_stock_reservations()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.reservation.expire') THEN
    RAISE EXCEPTION 'Sem permissão para processar vencimentos.' USING errcode = '42501';
  END IF;
  RETURN public.expire_reservations_internal(NULL, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.stock_available(_variant uuid, _location uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT quantity - reserved FROM public.stock_balances
                    WHERE variant_id = _variant AND location_id = _location), 0);
$$;

DROP FUNCTION IF EXISTS public.register_stock_movement(
  stock_move_kind, uuid, integer, uuid, uuid, text, integer, text, text);
DROP FUNCTION IF EXISTS public.register_stock_movement(
  stock_move_kind, uuid, integer, uuid, uuid, text, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.register_stock_movement(
  _kind stock_move_kind,
  _variant_id uuid,
  _quantity integer,
  _from_location_id uuid DEFAULT NULL,
  _to_location_id uuid DEFAULT NULL,
  _reason_code text DEFAULT NULL,
  _unit_cost_cents integer DEFAULT NULL,
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _reservation_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  saldo integer; mov uuid; atual integer;
  a uuid; b uuid; motivo_ok boolean;
  pode_custo boolean;
  custo integer := _unit_cost_cents;
  custo_descartado boolean := false;
  fb integer; fa integer; tb integer; ta integer;
  res_from integer := 0; res_to integer := 0; livre integer;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para movimentar estoque.' USING errcode = '42501';
  END IF;
  IF _kind IN ('ajuste','inventario') AND NOT public.has_capability(uid, 'stock.adjust') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar estoque.' USING errcode = '42501';
  END IF;

  pode_custo := public.has_capability(uid, 'stock.cost.view');
  IF custo IS NOT NULL AND NOT pode_custo THEN
    custo := NULL; custo_descartado := true;
  END IF;
  IF custo IS NOT NULL AND custo < 0 THEN
    RAISE EXCEPTION 'O custo unitário não pode ser negativo.';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
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
END $$;

CREATE OR REPLACE FUNCTION public.create_stock_reservation(
  _variant_id uuid,
  _location_id uuid,
  _quantity integer,
  _expires_at timestamptz,
  _origin text DEFAULT 'manual',
  _reference text DEFAULT NULL,
  _party_id uuid DEFAULT NULL,
  _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  uid uuid := auth.uid();
  fisico integer; reservado integer; livre integer;
  novo public.stock_reservations; proto text;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid,'stock.reservation.create') THEN
    RAISE EXCEPTION 'Sem permissão para reservar estoque.' USING errcode = '42501';
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO novo FROM public.stock_reservations WHERE idempotency_key = _idempotency_key;
    IF novo.id IS NOT NULL THEN
      RETURN jsonb_build_object('id', novo.id, 'protocolo', novo.protocol,
                                'situacao', novo.status, 'repetida', true);
    END IF;
  END IF;

  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero.';
  END IF;
  IF _expires_at IS NULL THEN RAISE EXCEPTION 'Informe a validade da reserva.'; END IF;
  IF _expires_at <= now() THEN RAISE EXCEPTION 'A validade precisa ser no futuro.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = _variant_id AND is_active) THEN
    RAISE EXCEPTION 'Peça inexistente ou inativa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = _location_id AND is_active) THEN
    RAISE EXCEPTION 'Local de estoque inexistente ou inativo.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_variant_id::text || _location_id::text, 0));
  PERFORM public.expire_reservations_internal(_variant_id, _location_id);

  SELECT quantity, reserved INTO fisico, reservado FROM public.stock_balances
    WHERE variant_id = _variant_id AND location_id = _location_id FOR UPDATE;
  fisico := coalesce(fisico, 0); reservado := coalesce(reservado, 0);
  livre := fisico - reservado;

  IF _quantity > livre THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (uid, 'stock.reservation.refused', 'stock_reservations', _variant_id::text,
      jsonb_build_object('motivo','sem disponibilidade','pedido',_quantity,
        'disponivel', greatest(livre,0), 'fisico', fisico, 'reservado', reservado,
        'location_id', _location_id));
    RAISE EXCEPTION 'Existem apenas % unidades disponíveis neste local.', greatest(livre,0);
  END IF;

  proto := 'RSV-' || to_char(now(),'YYMMDD') || '-' ||
           lpad(nextval('public.stock_reservation_protocol_seq')::text, 5, '0');

  INSERT INTO public.stock_reservations (
    protocol, variant_id, location_id, quantity, status, origin,
    external_reference, party_id, note, expires_at, created_by, idempotency_key, metadata)
  VALUES (proto, _variant_id, _location_id, _quantity, 'ativa',
    coalesce(nullif(trim(_origin),''),'manual'), nullif(trim(coalesce(_reference,'')),''),
    _party_id, nullif(trim(coalesce(_note,'')),''), _expires_at, uid, _idempotency_key,
    jsonb_build_object('fisico_na_criacao', fisico, 'reservado_antes', reservado))
  RETURNING * INTO novo;

  INSERT INTO public.stock_balances (variant_id, location_id, quantity, reserved)
  VALUES (_variant_id, _location_id, 0, 0)
  ON CONFLICT (variant_id, location_id) DO NOTHING;

  UPDATE public.stock_balances
     SET reserved = reserved + _quantity, updated_at = now()
   WHERE variant_id = _variant_id AND location_id = _location_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'stock.reservation.created', 'stock_reservations', novo.id::text,
    jsonb_build_object('protocolo', proto, 'quantidade', _quantity,
      'reservado_antes', reservado, 'reservado_depois', reservado + _quantity,
      'fisico', fisico, 'validade', _expires_at, 'origem', _origin,
      'variant_id', _variant_id, 'location_id', _location_id));

  RETURN jsonb_build_object('id', novo.id, 'protocolo', proto, 'situacao', 'ativa',
    'fisico', fisico, 'reservado', reservado + _quantity,
    'disponivel', fisico - reservado - _quantity, 'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.confirm_stock_reservation(
  _reservation_id uuid,
  _reason_code text DEFAULT 'venda',
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r public.stock_reservations; mov uuid; motivo text;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid,'stock.reservation.confirm') THEN
    RAISE EXCEPTION 'Sem permissão para confirmar reservas.' USING errcode = '42501';
  END IF;

  SELECT * INTO r FROM public.stock_reservations WHERE id = _reservation_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Reserva não encontrada.'; END IF;

  IF r.status = 'confirmada' THEN
    RETURN jsonb_build_object('id', r.id, 'protocolo', r.protocol, 'situacao', 'confirmada',
      'movimento_id', r.movement_id, 'repetida', true,
      'mensagem', 'Esta reserva já foi confirmada.');
  END IF;
  IF r.status <> 'ativa' THEN
    RAISE EXCEPTION 'Esta reserva está % e não pode ser confirmada.', r.status;
  END IF;
  IF r.expires_at <= now() THEN
    PERFORM public.expire_reservations_internal(r.variant_id, r.location_id);
    RAISE EXCEPTION 'Esta reserva venceu e não compromete mais o estoque.';
  END IF;

  motivo := coalesce(nullif(trim(coalesce(_reason_code,'')),''), 'venda');
  IF NOT EXISTS (SELECT 1 FROM public.stock_reasons
                  WHERE code = motivo AND kind = 'saida' AND is_active) THEN
    SELECT code INTO motivo FROM public.stock_reasons
      WHERE kind = 'saida' AND is_active ORDER BY code LIMIT 1;
  END IF;

  mov := public.register_stock_movement(
    'saida'::stock_move_kind, r.variant_id, r.quantity, r.location_id, NULL,
    motivo, NULL, coalesce(_reference, r.external_reference, r.protocol),
    coalesce(_note, 'Confirmação da reserva ' || r.protocol),
    coalesce(_idempotency_key, 'reserva:' || r.id::text), r.id);

  UPDATE public.stock_balances
     SET reserved = greatest(reserved - r.quantity, 0), updated_at = now()
   WHERE variant_id = r.variant_id AND location_id = r.location_id;

  UPDATE public.stock_reservations
     SET status = 'confirmada', confirmed_at = now(), confirmed_by = uid, movement_id = mov
   WHERE id = r.id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'stock.reservation.confirmed', 'stock_reservations', r.id::text,
    jsonb_build_object('protocolo', r.protocol, 'quantidade', r.quantity,
      'movimento_id', mov, 'situacao_anterior', 'ativa', 'situacao_atual', 'confirmada'));

  RETURN jsonb_build_object('id', r.id, 'protocolo', r.protocol, 'situacao', 'confirmada',
    'movimento_id', mov, 'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.release_stock_reservation(
  _reservation_id uuid,
  _cancelar boolean DEFAULT false,
  _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); r public.stock_reservations; novo text;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid,'stock.reservation.cancel') THEN
    RAISE EXCEPTION 'Sem permissão para liberar reservas.' USING errcode = '42501';
  END IF;

  SELECT * INTO r FROM public.stock_reservations WHERE id = _reservation_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Reserva não encontrada.'; END IF;

  IF _cancelar AND nullif(trim(coalesce(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  IF r.status IN ('liberada','cancelada','vencida') THEN
    RETURN jsonb_build_object('id', r.id, 'protocolo', r.protocol, 'situacao', r.status,
      'repetida', true, 'mensagem', 'Esta reserva já não compromete o estoque.');
  END IF;
  IF r.status = 'confirmada' THEN
    RAISE EXCEPTION 'Esta reserva já foi confirmada.';
  END IF;

  novo := CASE WHEN _cancelar THEN 'cancelada' ELSE 'liberada' END;

  UPDATE public.stock_reservations
     SET status = novo::public.stock_reservation_status, released_at = now(), released_by = uid,
         cancel_reason = nullif(trim(coalesce(_reason,'')),'')
   WHERE id = r.id AND status = 'ativa';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('id', r.id, 'protocolo', r.protocol, 'situacao', r.status,
      'repetida', true);
  END IF;

  UPDATE public.stock_balances
     SET reserved = greatest(reserved - r.quantity, 0), updated_at = now()
   WHERE variant_id = r.variant_id AND location_id = r.location_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (uid, 'stock.reservation.' || novo, 'stock_reservations', r.id::text,
    jsonb_build_object('protocolo', r.protocol, 'quantidade', r.quantity,
      'situacao_anterior', 'ativa', 'situacao_atual', novo,
      'justificativa', nullif(trim(coalesce(_reason,'')),''),
      'idempotencia', _idempotency_key));

  RETURN jsonb_build_object('id', r.id, 'protocolo', r.protocol, 'situacao', novo,
    'repetida', false);
END $$;

CREATE OR REPLACE FUNCTION public.stock_reservations_list(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _location uuid DEFAULT NULL,
  _origin text DEFAULT NULL,
  _validade text DEFAULT NULL,
  _variant uuid DEFAULT NULL,
  _page integer DEFAULT 0,
  _size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE termo text; lim integer; off integer; res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.reservation.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver reservas.' USING errcode = '42501';
  END IF;
  PERFORM public.expire_reservations_internal(NULL, NULL);

  termo := nullif(trim(coalesce(_search,'')), '');
  lim := least(greatest(coalesce(_size,20),1), 100);
  off := greatest(coalesce(_page,0),0) * lim;

  WITH base AS (
    SELECT r.*, v.label AS variante, v.sku, v.barcode, v.legacy_code,
           p.id AS produto_id, p.name AS produto, l.name AS local_nome, l.code AS local_codigo,
           (SELECT ma.storage_path FROM public.product_media pm
              JOIN public.media_assets ma ON ma.id = pm.media_id
             WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_path,
           (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
              FROM public.profiles pf WHERE pf.id = r.created_by) AS autor,
           (SELECT pa.display_name FROM public.parties pa WHERE pa.id = r.party_id) AS pessoa
      FROM public.stock_reservations r
      JOIN public.product_variants v ON v.id = r.variant_id
      JOIN public.products p ON p.id = v.product_id
      JOIN public.locations l ON l.id = r.location_id
     WHERE (_status IS NULL OR _status = 'todas' OR r.status::text = _status)
       AND (_location IS NULL OR r.location_id = _location)
       AND (_variant IS NULL OR r.variant_id = _variant)
       AND (_origin IS NULL OR _origin = 'todas' OR r.origin = _origin)
       AND (_validade IS NULL OR _validade = 'todas'
            OR (_validade = 'vencendo' AND r.status = 'ativa' AND r.expires_at <= now() + interval '48 hours')
            OR (_validade = 'vencidas' AND r.expires_at <= now()))
       AND (termo IS NULL
            OR r.protocol ilike '%'||termo||'%'
            OR coalesce(r.external_reference,'') ilike '%'||termo||'%'
            OR p.name ilike '%'||termo||'%'
            OR v.label ilike '%'||termo||'%'
            OR coalesce(v.sku,'') ilike '%'||termo||'%'
            OR coalesce(v.legacy_code,'') ilike '%'||termo||'%'
            OR coalesce(v.barcode,'') ilike '%'||termo||'%')
  ), pagina AS (
    SELECT * FROM base ORDER BY created_at DESC LIMIT lim OFFSET off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'protocolo', x.protocol, 'situacao', x.status,
        'quantidade', x.quantity, 'origem', x.origin, 'referencia', x.external_reference,
        'pessoa', x.pessoa, 'party_id', x.party_id, 'observacao', x.note,
        'criada_em', x.created_at, 'validade', x.expires_at,
        'confirmada_em', x.confirmed_at, 'liberada_em', x.released_at,
        'motivo_cancelamento', x.cancel_reason, 'movimento_id', x.movement_id,
        'autor', x.autor, 'variant_id', x.variant_id, 'variante', x.variante,
        'sku', x.sku, 'produto_id', x.produto_id, 'produto', x.produto,
        'local_id', x.location_id, 'local', x.local_nome, 'local_codigo', x.local_codigo,
        'media_path', x.media_path) ORDER BY x.created_at DESC) FROM pagina x), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.stock_reservation_detail(_reservation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.reservation.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver reservas.' USING errcode = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', r.id, 'protocolo', r.protocol, 'situacao', r.status, 'quantidade', r.quantity,
    'origem', r.origin, 'referencia', r.external_reference, 'observacao', r.note,
    'criada_em', r.created_at, 'validade', r.expires_at, 'confirmada_em', r.confirmed_at,
    'liberada_em', r.released_at, 'motivo_cancelamento', r.cancel_reason,
    'movimento_id', r.movement_id,
    'produto', p.name, 'variante', v.label, 'sku', v.sku, 'local', l.name,
    'pessoa', (SELECT pa.display_name FROM public.parties pa WHERE pa.id = r.party_id),
    'autor', (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
                FROM public.profiles pf WHERE pf.id = r.created_by),
    'historico', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'acao', a.action, 'em', a.created_at, 'dados', a.payload,
               'autor', (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
                           FROM public.profiles pf WHERE pf.id = a.actor_id))
             ORDER BY a.created_at)
        FROM public.audit_logs a
       WHERE a.entity = 'stock_reservations' AND a.entity_id = r.id::text), '[]'::jsonb)
  ) INTO res
  FROM public.stock_reservations r
  JOIN public.product_variants v ON v.id = r.variant_id
  JOIN public.products p ON p.id = v.product_id
  JOIN public.locations l ON l.id = r.location_id
  WHERE r.id = _reservation_id;
  IF res IS NULL THEN RAISE EXCEPTION 'Reserva não encontrada.'; END IF;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.stock_balances_list(
  _search text DEFAULT NULL, _location uuid DEFAULT NULL,
  _only_positive boolean DEFAULT false, _page integer DEFAULT 0, _size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE termo text; lim integer; off integer; res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o estoque.' USING errcode = '42501';
  END IF;
  PERFORM public.expire_reservations_internal(NULL, NULL);
  termo := nullif(trim(coalesce(_search,'')), '');
  lim := least(greatest(coalesce(_size,20),1), 100);
  off := greatest(coalesce(_page,0),0) * lim;

  WITH base AS (
    SELECT b.id, b.quantity, b.reserved, (b.quantity - b.reserved) AS available, b.updated_at,
           l.id AS local_id, l.name AS local_nome, l.code AS local_codigo,
           v.id AS variant_id, v.label AS variante, v.sku, v.barcode, v.legacy_code,
           p.id AS produto_id, p.name AS produto, p.slug AS produto_slug,
           (SELECT pm.media_id FROM public.product_media pm
              WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS media_id
      FROM public.stock_balances b
      JOIN public.locations l ON l.id = b.location_id
      JOIN public.product_variants v ON v.id = b.variant_id
      JOIN public.products p ON p.id = v.product_id
     WHERE (_location IS NULL OR b.location_id = _location)
       AND (NOT coalesce(_only_positive,false) OR b.quantity > 0)
       AND (termo IS NULL
            OR p.name ilike '%'||termo||'%'
            OR v.label ilike '%'||termo||'%'
            OR coalesce(v.sku,'') ilike '%'||termo||'%'
            OR coalesce(v.legacy_code,'') ilike '%'||termo||'%'
            OR coalesce(v.barcode,'') ilike '%'||termo||'%')
  ), pagina AS (
    SELECT * FROM base ORDER BY updated_at DESC LIMIT lim OFFSET off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'reservas_ativas', true,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'quantity', x.quantity, 'reserved', x.reserved,
        'available', x.available, 'updated_at', x.updated_at,
        'local_id', x.local_id, 'local_nome', x.local_nome, 'local_codigo', x.local_codigo,
        'variant_id', x.variant_id, 'variante', x.variante, 'sku', x.sku,
        'barcode', x.barcode, 'legacy_code', x.legacy_code,
        'produto_id', x.produto_id, 'produto', x.produto, 'produto_slug', x.produto_slug,
        'media_id', x.media_id,
        'media_path', (SELECT ma.storage_path FROM public.media_assets ma WHERE ma.id = x.media_id)
      ) ORDER BY x.updated_at DESC) FROM pagina x
    ), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.stock_item_detail(_variant uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ver_custo boolean; ver_reserva boolean; res jsonb; prod uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o estoque.' USING errcode = '42501';
  END IF;
  ver_custo := public.has_capability(auth.uid(),'stock.cost.view');
  ver_reserva := public.has_capability(auth.uid(),'stock.reservation.view');
  PERFORM public.expire_reservations_internal(_variant, NULL);

  SELECT product_id INTO prod FROM public.product_variants WHERE id = _variant;
  IF prod IS NULL THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;

  SELECT jsonb_build_object(
    'variant_id', v.id, 'variante', v.label, 'sku', v.sku, 'barcode', v.barcode,
    'legacy_code', v.legacy_code, 'is_active', v.is_active,
    'produto_id', p.id, 'produto', p.name, 'produto_slug', p.slug, 'produto_status', p.status,
    'categoria', c.name, 'colecao', col.name,
    'reservas_ativas', true,
    'pode_ver_reserva', ver_reserva,
    'pode_ver_custo', ver_custo,
    'custo_cents', CASE WHEN ver_custo THEN (
      SELECT vc.cost_cents FROM public.variant_costs vc
       WHERE vc.variant_id = v.id ORDER BY vc.effective_from DESC, vc.created_at DESC LIMIT 1) END,
    'midias', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', ma.id, 'path', ma.storage_path, 'alt', ma.alt)
             ORDER BY pm.position)
        FROM public.product_media pm JOIN public.media_assets ma ON ma.id = pm.media_id
       WHERE pm.product_id = p.id AND NOT ma.is_archived), '[]'::jsonb),
    'saldos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'local_id', l.id, 'local', l.name, 'codigo', l.code,
               'quantity', b.quantity, 'reserved', b.reserved,
               'available', b.quantity - b.reserved, 'updated_at', b.updated_at)
             ORDER BY l.name)
        FROM public.stock_balances b JOIN public.locations l ON l.id = b.location_id
       WHERE b.variant_id = v.id), '[]'::jsonb),
    'reservas', CASE WHEN ver_reserva THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'protocolo', r.protocol, 'situacao', r.status,
               'quantidade', r.quantity, 'validade', r.expires_at, 'criada_em', r.created_at,
               'origem', r.origin, 'local', (SELECT name FROM public.locations WHERE id = r.location_id),
               'pessoa', (SELECT pa.display_name FROM public.parties pa WHERE pa.id = r.party_id),
               'autor', (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
                           FROM public.profiles pf WHERE pf.id = r.created_by))
             ORDER BY r.created_at DESC)
        FROM (SELECT * FROM public.stock_reservations rr
               WHERE rr.variant_id = v.id ORDER BY rr.created_at DESC LIMIT 10) r), '[]'::jsonb)
      ELSE '[]'::jsonb END,
    'reservas_ativas_qtd', CASE WHEN ver_reserva THEN (
      SELECT count(*) FROM public.stock_reservations r
       WHERE r.variant_id = v.id AND r.status = 'ativa') ELSE NULL END,
    'proxima_a_vencer', CASE WHEN ver_reserva THEN (
      SELECT jsonb_build_object('id', r.id, 'protocolo', r.protocol,
               'validade', r.expires_at, 'quantidade', r.quantity)
        FROM public.stock_reservations r
       WHERE r.variant_id = v.id AND r.status = 'ativa'
       ORDER BY r.expires_at LIMIT 1) END,
    'ultima_movimentacao', (
      SELECT (jsonb_build_object(
                'id', m.id, 'kind', m.kind, 'quantity', m.quantity, 'created_at', m.created_at,
                'reason_code', m.reason_code, 'reference', m.reference,
                'unit_cost_cents', m.unit_cost_cents,
                'origem', (SELECT name FROM public.locations WHERE id = m.from_location_id),
                'destino', (SELECT name FROM public.locations WHERE id = m.to_location_id),
                'autor', (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
                            FROM public.profiles pf WHERE pf.id = m.created_by))
              - (CASE WHEN ver_custo THEN '{}'::text[] ELSE array['unit_cost_cents'] END))
        FROM public.stock_movements m WHERE m.variant_id = v.id
       ORDER BY m.created_at DESC LIMIT 1)
  ) INTO res
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN public.collections col ON col.id = p.collection_id
  WHERE v.id = _variant;

  RETURN res;
END $$;
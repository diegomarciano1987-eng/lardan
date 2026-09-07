-- =====================================================================
-- LARDAN Cloud — Estoque operacional, lote 1
-- =====================================================================

-- 1. Saldos por lado da operação -------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS balance_from_before integer,
  ADD COLUMN IF NOT EXISTS balance_from_after  integer,
  ADD COLUMN IF NOT EXISTS balance_to_before   integer,
  ADD COLUMN IF NOT EXISTS balance_to_after    integer;

-- custo nunca negativo
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_unit_cost_nonneg;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_unit_cost_nonneg
  CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_created
  ON public.stock_movements (variant_id, created_at DESC);

-- 2. Movimentação canônica -------------------------------------------
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
  _idempotency_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  saldo integer; mov uuid; atual integer;
  a uuid; b uuid; motivo_ok boolean;
  pode_custo boolean;
  custo integer := _unit_cost_cents;
  custo_descartado boolean := false;
  fb integer; fa integer; tb integer; ta integer;
BEGIN
  IF uid IS NULL OR NOT public.has_capability(uid, 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para movimentar estoque.' USING errcode = '42501';
  END IF;
  IF _kind IN ('ajuste','inventario') AND NOT public.has_capability(uid, 'stock.adjust') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar estoque.' USING errcode = '42501';
  END IF;

  -- custo só para quem pode ver/informar custo; dos demais é descartado
  pode_custo := public.has_capability(uid, 'stock.cost.view');
  IF custo IS NOT NULL AND NOT pode_custo THEN
    custo := NULL;
    custo_descartado := true;
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

  -- justificativa escrita obrigatória em ajuste, perda e avaria
  IF (_kind = 'ajuste' OR coalesce(_reason_code,'') IN ('perda','avaria'))
     AND nullif(trim(coalesce(_note,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Escreva a justificativa desta operação.';
  END IF;

  -- documento obrigatório no recebimento de compra
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

  SELECT quantity INTO fb FROM public.stock_balances
    WHERE variant_id = _variant_id AND location_id = _from_location_id;
  SELECT quantity INTO tb FROM public.stock_balances
    WHERE variant_id = _variant_id AND location_id = _to_location_id;
  IF _from_location_id IS NOT NULL THEN fb := coalesce(fb, 0); END IF;
  IF _to_location_id IS NOT NULL THEN tb := coalesce(tb, 0); END IF;

  IF _kind = 'entrada' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de destino.'; END IF;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
  ELSIF _kind = 'saida' THEN
    IF _from_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local de origem.'; END IF;
    fa := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    saldo := fa;
  ELSIF _kind = 'transferencia' THEN
    IF _from_location_id IS NULL OR _to_location_id IS NULL THEN
      RAISE EXCEPTION 'Informe origem e destino.';
    END IF;
    IF _from_location_id = _to_location_id THEN
      RAISE EXCEPTION 'Origem e destino devem ser diferentes.';
    END IF;
    fa := public.apply_stock_delta(_variant_id, _from_location_id, -_quantity);
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
  ELSIF _kind = 'ajuste' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity);
    saldo := ta;
  ELSIF _kind = 'inventario' THEN
    IF _to_location_id IS NULL THEN RAISE EXCEPTION 'Informe o local.'; END IF;
    SELECT COALESCE(quantity,0) INTO atual FROM public.stock_balances
      WHERE variant_id = _variant_id AND location_id = _to_location_id;
    ta := public.apply_stock_delta(_variant_id, _to_location_id, _quantity - COALESCE(atual,0));
    saldo := ta;
  END IF;

  INSERT INTO public.stock_movements (
    kind, variant_id, from_location_id, to_location_id, quantity,
    unit_cost_cents, reason_code, reference, note, balance_after, created_by, idempotency_key,
    balance_from_before, balance_from_after, balance_to_before, balance_to_after
  ) VALUES (
    _kind, _variant_id, _from_location_id, _to_location_id, _quantity,
    custo, _reason_code, _reference, _note, saldo, uid, _idempotency_key,
    fb, fa, tb, ta
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

REVOKE ALL ON FUNCTION public.register_stock_movement(stock_move_kind,uuid,integer,uuid,uuid,text,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_stock_movement(stock_move_kind,uuid,integer,uuid,uuid,text,integer,text,text,text) TO authenticated, service_role;

-- 3. Listagem de saldos com foto e busca ampla ------------------------
CREATE OR REPLACE FUNCTION public.stock_balances_list(
  _search text DEFAULT NULL,
  _location uuid DEFAULT NULL,
  _only_positive boolean DEFAULT false,
  _page integer DEFAULT 0,
  _size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE termo text; lim integer; off integer; res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o estoque.' USING errcode = '42501';
  END IF;
  termo := nullif(trim(coalesce(_search,'')), '');
  lim := least(greatest(coalesce(_size,20),1), 100);
  off := greatest(coalesce(_page,0),0) * lim;

  WITH base AS (
    SELECT b.id, b.quantity, b.reserved, b.updated_at,
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
    'reservas_ativas', false,
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'quantity', x.quantity, 'reserved', x.reserved, 'updated_at', x.updated_at,
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
END $function$;

REVOKE ALL ON FUNCTION public.stock_balances_list(text,uuid,boolean,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_balances_list(text,uuid,boolean,integer,integer) TO authenticated, service_role;

-- 4. Ficha do item de estoque -----------------------------------------
CREATE OR REPLACE FUNCTION public.stock_item_detail(_variant uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ver_custo boolean; res jsonb; prod uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o estoque.' USING errcode = '42501';
  END IF;
  ver_custo := public.has_capability(auth.uid(),'stock.cost.view');

  SELECT product_id INTO prod FROM public.product_variants WHERE id = _variant;
  IF prod IS NULL THEN RAISE EXCEPTION 'Peça não encontrada.'; END IF;

  SELECT jsonb_build_object(
    'variant_id', v.id, 'variante', v.label, 'sku', v.sku, 'barcode', v.barcode,
    'legacy_code', v.legacy_code, 'is_active', v.is_active,
    'produto_id', p.id, 'produto', p.name, 'produto_slug', p.slug, 'produto_status', p.status,
    'categoria', c.name, 'colecao', col.name,
    'reservas_ativas', false,
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
               'quantity', b.quantity, 'reserved', b.reserved, 'updated_at', b.updated_at)
             ORDER BY l.name)
        FROM public.stock_balances b JOIN public.locations l ON l.id = b.location_id
       WHERE b.variant_id = v.id), '[]'::jsonb),
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
END $function$;

REVOKE ALL ON FUNCTION public.stock_item_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_item_detail(uuid) TO authenticated, service_role;

-- 5. Histórico com autor, saldos por lado e custo autorizado -----------
CREATE OR REPLACE FUNCTION public.stock_movements_list(
  _search text DEFAULT NULL,
  _kind text DEFAULT NULL,
  _variant uuid DEFAULT NULL,
  _page integer DEFAULT 0,
  _size integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ver_custo boolean; termo text; lim integer; off integer; res jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(),'stock.view') THEN
    RAISE EXCEPTION 'Sem permissão para ver o estoque.' USING errcode = '42501';
  END IF;
  ver_custo := public.has_capability(auth.uid(),'stock.cost.view');
  termo := nullif(trim(coalesce(_search,'')), '');
  lim := least(greatest(coalesce(_size,20),1), 100);
  off := greatest(coalesce(_page,0),0) * lim;

  WITH base AS (
    SELECT m.*, v.label AS variante, v.sku AS sku, v.product_id, pr.name AS produto
      FROM public.stock_movements m
      JOIN public.product_variants v ON v.id = m.variant_id
      JOIN public.products pr ON pr.id = v.product_id
     WHERE (_kind IS NULL OR _kind = 'todos' OR m.kind::text = _kind)
       AND (_variant IS NULL OR m.variant_id = _variant)
       AND (termo IS NULL OR v.label ilike '%'||termo||'%'
            OR coalesce(v.sku,'') ilike '%'||termo||'%'
            OR coalesce(v.legacy_code,'') ilike '%'||termo||'%'
            OR pr.name ilike '%'||termo||'%'
            OR coalesce(v.barcode,'') ilike '%'||termo||'%')
  ), pagina AS (
    SELECT * FROM base ORDER BY created_at DESC LIMIT lim OFFSET off
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'pode_ver_custo', ver_custo,
    'rows', coalesce((
      SELECT jsonb_agg(
        (jsonb_build_object(
          'id', m.id, 'kind', m.kind, 'quantity', m.quantity,
          'unit_cost_cents', m.unit_cost_cents,
          'reason_code', m.reason_code, 'reference', m.reference, 'note', m.note,
          'balance_after', m.balance_after, 'created_at', m.created_at,
          'balance_from_before', m.balance_from_before, 'balance_from_after', m.balance_from_after,
          'balance_to_before', m.balance_to_before, 'balance_to_after', m.balance_to_after,
          'variante', m.variante, 'sku', m.sku, 'produto', m.produto,
          'variant_id', m.variant_id,
          'media_id', (SELECT pm.media_id FROM public.product_media pm
                        WHERE pm.product_id = m.product_id ORDER BY pm.position LIMIT 1),
          'media_path', (SELECT ma.storage_path FROM public.product_media pm
                          JOIN public.media_assets ma ON ma.id = pm.media_id
                         WHERE pm.product_id = m.product_id ORDER BY pm.position LIMIT 1),
          'motivo', (SELECT sr.label FROM public.stock_reasons sr
                      WHERE sr.code = m.reason_code AND sr.kind = m.kind LIMIT 1),
          'autor', (SELECT coalesce(pf.display_name, pf.full_name, pf.email)
                      FROM public.profiles pf WHERE pf.id = m.created_by),
          'origem', lo.name, 'destino', ld.name)
         - (CASE WHEN ver_custo THEN '{}'::text[] ELSE array['unit_cost_cents'] END))
        ORDER BY m.created_at DESC)
      FROM pagina m
      LEFT JOIN public.locations lo ON lo.id = m.from_location_id
      LEFT JOIN public.locations ld ON ld.id = m.to_location_id
    ), '[]'::jsonb)
  ) INTO res;

  RETURN res;
END $function$;

REVOKE ALL ON FUNCTION public.stock_movements_list(text,text,uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_movements_list(text,text,uuid,integer,integer) TO authenticated, service_role;
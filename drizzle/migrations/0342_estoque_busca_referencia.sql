CREATE OR REPLACE FUNCTION public.stock_balances_list(_search text DEFAULT NULL::text, _location uuid DEFAULT NULL::uuid, _only_positive boolean DEFAULT false, _page integer DEFAULT 0, _size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            OR coalesce(v.barcode,'') ilike '%'||termo||'%'
            OR coalesce(v.reference_code,'') ilike '%'||termo||'%'
            OR coalesce(p.reference_code,'') ilike '%'||termo||'%')
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
END $function$;

CREATE OR REPLACE FUNCTION public.stock_movements_list(_search text DEFAULT NULL::text, _kind text DEFAULT NULL::text, _variant uuid DEFAULT NULL::uuid, _page integer DEFAULT 0, _size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
            OR coalesce(v.barcode,'') ilike '%'||termo||'%'
            OR coalesce(v.reference_code,'') ilike '%'||termo||'%'
            OR coalesce(pr.reference_code,'') ilike '%'||termo||'%')
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
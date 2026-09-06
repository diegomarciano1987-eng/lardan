CREATE OR REPLACE FUNCTION public.showcase_list(_f jsonb DEFAULT '{}'::jsonb, _sort text DEFAULT 'updated_desc', _limit integer DEFAULT 40, _offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, name text, slug text, sku text, status content_status,
  price_cents integer, price_is_public boolean, is_featured boolean, is_new_arrival boolean,
  scheduled_publish_at timestamptz, updated_at timestamptz, created_at timestamptz,
  category_id uuid, category_name text, collection_id uuid, collection_name text,
  supplier_name text, material text, plating text, tags text[],
  cover_media_id uuid, cover_alt text, estoque bigint, faltando text[], total bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _busca text := nullif(btrim(coalesce(_f->>'busca','')), '');
  _ids uuid[] := CASE WHEN _f ? 'ids' THEN ARRAY(SELECT (jsonb_array_elements_text(_f->'ids'))::uuid) END;
BEGIN
  IF NOT (public.can_manage_content(auth.uid()) OR public.has_capability(auth.uid(),'catalog.view')) THEN
    RAISE EXCEPTION 'sem permissao para ver a vitrine';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.*,
      c.name AS cat_name, col.name AS col_name, s.name AS sup_name,
      (SELECT pm.media_id FROM product_media pm WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS cover_id,
      (SELECT ma.alt FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
         WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS cover_alt_txt,
      (SELECT v.sku FROM product_variants v WHERE v.product_id = p.id ORDER BY v.position LIMIT 1) AS first_sku,
      COALESCE((SELECT SUM(sb.quantity) FROM stock_balances sb
        JOIN product_variants v2 ON v2.id = sb.variant_id WHERE v2.product_id = p.id), 0)::bigint AS estoque_total
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN collections col ON col.id = p.collection_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
  ), calc AS (
    SELECT b.*,
      (ARRAY_REMOVE(ARRAY[
        CASE WHEN btrim(coalesce(b.name,'')) = '' THEN 'nome' END,
        CASE WHEN btrim(coalesce(b.slug,'')) = '' THEN 'slug' END,
        CASE WHEN b.category_id IS NULL THEN 'categoria' END,
        CASE WHEN btrim(coalesce(b.description,'')) = '' THEN 'descricao' END,
        CASE WHEN b.cover_id IS NULL THEN 'imagem' END,
        CASE WHEN b.cover_id IS NOT NULL AND btrim(coalesce(b.cover_alt_txt,'')) = '' THEN 'texto_alternativo' END,
        CASE WHEN b.price_is_public AND b.price_cents IS NULL THEN 'preco' END,
        CASE WHEN btrim(coalesce(b.material,'')) = '' THEN 'material' END,
        CASE WHEN btrim(coalesce(b.measurements,'')) = '' THEN 'medidas' END,
        CASE WHEN btrim(coalesce(b.care_instructions,'')) = '' THEN 'cuidados' END,
        CASE WHEN btrim(coalesce(b.warranty_text,'')) = '' THEN 'garantia' END
      ], NULL)) AS faltando_arr
    FROM base b
  ), filtrado AS (
    SELECT * FROM calc x WHERE
      (_ids IS NULL OR x.id = ANY(_ids))
      AND (_f->>'sem_categoria' IS NULL OR (x.category_id IS NULL) = (_f->>'sem_categoria')::boolean)
      AND (_busca IS NULL OR (
        x.name ILIKE '%'||_busca||'%' OR x.slug ILIKE '%'||_busca||'%'
        OR coalesce(x.description,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.short_description,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.legacy_code,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.cat_name,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.col_name,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.sup_name,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.material,'') ILIKE '%'||_busca||'%'
        OR coalesce(x.plating,'') ILIKE '%'||_busca||'%'
        OR EXISTS (SELECT 1 FROM unnest(x.tags) t WHERE t ILIKE '%'||_busca||'%')
        OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = x.id AND (
             coalesce(v.sku,'') ILIKE '%'||_busca||'%' OR coalesce(v.barcode,'') ILIKE '%'||_busca||'%'
             OR coalesce(v.legacy_code,'') ILIKE '%'||_busca||'%'))
      ))
      AND (_f->>'categoria_id' IS NULL OR x.category_id = (_f->>'categoria_id')::uuid
           OR x.category_id IN (SELECT c2.id FROM categories c2 WHERE c2.parent_id = (_f->>'categoria_id')::uuid))
      AND (_f->>'colecao_id' IS NULL OR x.collection_id = (_f->>'colecao_id')::uuid)
      AND (_f->>'fornecedor_id' IS NULL OR x.supplier_id = (_f->>'fornecedor_id')::uuid)
      AND (_f->>'status' IS NULL OR x.status = (_f->>'status')::content_status)
      AND (_f->>'publicado' IS NULL OR (x.status = 'publicado') = (_f->>'publicado')::boolean)
      AND (_f->>'preco_publico' IS NULL OR x.price_is_public = (_f->>'preco_publico')::boolean)
      AND (_f->>'com_imagem' IS NULL OR (x.cover_id IS NOT NULL) = (_f->>'com_imagem')::boolean)
      AND (_f->>'com_preco' IS NULL OR (x.price_cents IS NOT NULL) = (_f->>'com_preco')::boolean)
      AND (_f->>'com_estoque' IS NULL OR (x.estoque_total > 0) = (_f->>'com_estoque')::boolean)
      AND (_f->>'destaque' IS NULL OR x.is_featured = (_f->>'destaque')::boolean)
      AND (_f->>'lancamento' IS NULL OR x.is_new_arrival = (_f->>'lancamento')::boolean)
      AND (_f->>'agendado' IS NULL OR (x.scheduled_publish_at IS NOT NULL) = (_f->>'agendado')::boolean)
      AND (_f->>'completo' IS NULL OR (cardinality(x.faltando_arr) = 0) = (_f->>'completo')::boolean)
      AND (_f->>'criado_de' IS NULL OR x.created_at >= (_f->>'criado_de')::timestamptz)
      AND (_f->>'criado_ate' IS NULL OR x.created_at < ((_f->>'criado_ate')::date + 1)::timestamptz)
      AND (_f->>'atualizado_de' IS NULL OR x.updated_at >= (_f->>'atualizado_de')::timestamptz)
      AND (_f->>'atualizado_ate' IS NULL OR x.updated_at < ((_f->>'atualizado_ate')::date + 1)::timestamptz)
      AND (_f->>'preco_min' IS NULL OR x.price_cents >= (_f->>'preco_min')::integer)
      AND (_f->>'preco_max' IS NULL OR x.price_cents <= (_f->>'preco_max')::integer)
      AND (_f->>'material' IS NULL OR x.material ILIKE '%'||(_f->>'material')||'%')
      AND (_f->>'banho' IS NULL OR x.plating ILIKE '%'||(_f->>'banho')||'%')
      AND (_f->>'tag' IS NULL OR EXISTS (SELECT 1 FROM unnest(x.tags) t WHERE t ILIKE (_f->>'tag')))
  )
  SELECT f.id, f.name, f.slug, f.first_sku, f.status, f.price_cents, f.price_is_public,
         f.is_featured, f.is_new_arrival, f.scheduled_publish_at, f.updated_at, f.created_at,
         f.category_id, f.cat_name, f.collection_id, f.col_name, f.sup_name,
         f.material, f.plating, f.tags, f.cover_id, f.cover_alt_txt, f.estoque_total,
         f.faltando_arr, (SELECT count(*) FROM filtrado)::bigint
  FROM filtrado f
  ORDER BY
    CASE WHEN _sort = 'nome_asc' THEN f.name END ASC,
    CASE WHEN _sort = 'nome_desc' THEN f.name END DESC,
    CASE WHEN _sort = 'preco_asc' THEN f.price_cents END ASC NULLS LAST,
    CASE WHEN _sort = 'preco_desc' THEN f.price_cents END DESC NULLS LAST,
    CASE WHEN _sort = 'criado_desc' THEN f.created_at END DESC,
    CASE WHEN _sort = 'estoque_desc' THEN f.estoque_total END DESC,
    f.updated_at DESC
  LIMIT greatest(1, least(_limit, 20000)) OFFSET greatest(0, _offset);
END;
$$;
-- Páginas públicas de categoria: detalhe editorial + listagem filtrável no servidor

CREATE OR REPLACE FUNCTION public.public_category(_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cat AS (
    SELECT * FROM public.categories
     WHERE slug = _slug AND status = 'publicado'
  ), prods AS (
    SELECT p.*, col.slug AS col_slug, col.name AS col_name
      FROM public.products p
      JOIN cat ON cat.id = p.category_id
      LEFT JOIN public.collections col ON col.id = p.collection_id AND col.status = 'publicado'
     WHERE p.status = 'publicado'
       AND (p.published_at IS NULL OR p.published_at <= now())
  )
  SELECT CASE WHEN (SELECT count(*) FROM cat) = 0 THEN NULL ELSE jsonb_build_object(
    'id', (SELECT id FROM cat),
    'slug', (SELECT slug FROM cat),
    'name', (SELECT name FROM cat),
    'description', (SELECT description FROM cat),
    'seo_title', (SELECT seo_title FROM cat),
    'seo_description', (SELECT seo_description FROM cat),
    'hero_media_id', (SELECT hero_media_id FROM cat),
    'hero_alt', (SELECT ma.alt FROM public.media_assets ma
                  WHERE ma.id = (SELECT hero_media_id FROM cat)),
    'fallback_media_id', (SELECT pm.media_id FROM prods p
                            JOIN public.product_media pm ON pm.product_id = p.id
                          ORDER BY p.is_featured DESC, p.position, pm.position LIMIT 1),
    'total', (SELECT count(*) FROM prods),
    'destaques', (SELECT count(*) FROM prods WHERE is_featured),
    'tem_preco_publico', (SELECT EXISTS (SELECT 1 FROM prods WHERE price_is_public)),
    'preco_min', (SELECT min(price_cents) FROM prods WHERE price_is_public),
    'preco_max', (SELECT max(price_cents) FROM prods WHERE price_is_public),
    'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('slug', col_slug, 'name', col_name))
                            FROM prods WHERE col_slug IS NOT NULL), '[]'::jsonb),
    'materiais', COALESCE((SELECT jsonb_agg(DISTINCT material)
                            FROM prods WHERE nullif(btrim(coalesce(material,'')),'') IS NOT NULL), '[]'::jsonb),
    'banhos', COALESCE((SELECT jsonb_agg(DISTINCT plating)
                            FROM prods WHERE nullif(btrim(coalesce(plating,'')),'') IS NOT NULL), '[]'::jsonb)
  ) END;
$$;

CREATE OR REPLACE FUNCTION public.public_catalog_browse(
  _category_slug text DEFAULT NULL,
  _collection_slug text DEFAULT NULL,
  _search text DEFAULT NULL,
  _material text DEFAULT NULL,
  _plating text DEFAULT NULL,
  _featured boolean DEFAULT NULL,
  _new_arrival boolean DEFAULT NULL,
  _in_stock boolean DEFAULT NULL,
  _price_min integer DEFAULT NULL,
  _price_max integer DEFAULT NULL,
  _sort text DEFAULT 'curadoria',
  _limit integer DEFAULT 12,
  _offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, slug text, name text, short_description text,
  category_slug text, category_name text,
  collection_slug text, collection_name text,
  material text, plating text,
  price_cents integer, is_featured boolean, is_new_arrival boolean,
  em_estoque boolean,
  cover_media_id uuid, cover_alt text,
  hover_media_id uuid, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT p.*, c.slug AS cat_slug, c.name AS cat_name,
           col.slug AS col_slug, col.name AS col_name,
           CASE WHEN p.price_is_public THEN COALESCE(p.price_cents,
                (SELECT v.price_cents FROM public.product_variants v
                  WHERE v.product_id = p.id AND v.is_active
                  ORDER BY v.is_default DESC, v.position LIMIT 1)) END AS preco_publico,
           COALESCE((SELECT SUM(sb.quantity) FROM public.stock_balances sb
                       JOIN public.product_variants v2 ON v2.id = sb.variant_id
                      WHERE v2.product_id = p.id), 0) AS estoque
      FROM public.products p
      LEFT JOIN public.categories c ON c.id = p.category_id AND c.status = 'publicado'
      LEFT JOIN public.collections col ON col.id = p.collection_id AND col.status = 'publicado'
     WHERE p.status = 'publicado'
       AND (p.published_at IS NULL OR p.published_at <= now())
       AND (_category_slug IS NULL OR c.slug = _category_slug)
       AND (_collection_slug IS NULL OR col.slug = _collection_slug)
       AND (_material IS NULL OR p.material = _material)
       AND (_plating IS NULL OR p.plating = _plating)
       AND (_featured IS NULL OR p.is_featured = _featured)
       AND (_new_arrival IS NULL OR p.is_new_arrival = _new_arrival)
       AND (nullif(btrim(coalesce(_search,'')),'') IS NULL
            OR p.name ILIKE '%'||btrim(_search)||'%'
            OR p.short_description ILIKE '%'||btrim(_search)||'%')
  ), filtrado AS (
    SELECT * FROM base
     WHERE (_price_min IS NULL OR preco_publico >= _price_min)
       AND (_price_max IS NULL OR preco_publico <= _price_max)
       AND (_in_stock IS NULL OR (_in_stock AND estoque > 0) OR (NOT _in_stock AND estoque <= 0))
  ), cont AS (SELECT count(*)::bigint AS n FROM filtrado)
  SELECT f.id, f.slug, f.name, f.short_description,
         f.cat_slug, f.cat_name, f.col_slug, f.col_name,
         f.material, f.plating,
         f.preco_publico, f.is_featured, f.is_new_arrival,
         (f.estoque > 0),
         (SELECT pm.media_id FROM public.product_media pm
            JOIN public.media_assets ma ON ma.id = pm.media_id AND NOT ma.is_archived
           WHERE pm.product_id = f.id ORDER BY pm.position LIMIT 1),
         (SELECT ma.alt FROM public.product_media pm
            JOIN public.media_assets ma ON ma.id = pm.media_id AND NOT ma.is_archived
           WHERE pm.product_id = f.id ORDER BY pm.position LIMIT 1),
         (SELECT pm.media_id FROM public.product_media pm
            JOIN public.media_assets ma ON ma.id = pm.media_id AND NOT ma.is_archived
           WHERE pm.product_id = f.id ORDER BY pm.position OFFSET 1 LIMIT 1),
         (SELECT n FROM cont)
    FROM filtrado f
   ORDER BY
     CASE WHEN _sort = 'nome' THEN f.name END ASC,
     CASE WHEN _sort = 'preco_asc' THEN f.preco_publico END ASC NULLS LAST,
     CASE WHEN _sort = 'preco_desc' THEN f.preco_publico END DESC NULLS LAST,
     CASE WHEN _sort = 'lancamentos' THEN f.published_at END DESC NULLS LAST,
     CASE WHEN _sort = 'curadoria' THEN (CASE WHEN f.is_featured THEN 0 ELSE 1 END) END ASC,
     f.position, f.published_at DESC NULLS LAST, f.name
   LIMIT greatest(coalesce(_limit,12),1) OFFSET greatest(coalesce(_offset,0),0);
$$;

REVOKE ALL ON FUNCTION public.public_category(text) FROM public;
REVOKE ALL ON FUNCTION public.public_catalog_browse(text,text,text,text,text,boolean,boolean,boolean,integer,integer,text,integer,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.public_category(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog_browse(text,text,text,text,text,boolean,boolean,boolean,integer,integer,text,integer,integer) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS products_public_browse_idx
  ON public.products (status, category_id, position, published_at DESC);
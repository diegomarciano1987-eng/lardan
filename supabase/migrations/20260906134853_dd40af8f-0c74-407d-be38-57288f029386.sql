ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

-- nunca duas variantes padrão do mesmo produto
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_one_default
  ON public.product_variants (product_id) WHERE is_default;

CREATE OR REPLACE FUNCTION public.public_categories()
RETURNS TABLE(id uuid, slug text, name text, description text, ordem integer, produtos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.slug, c.name, c.description, c.position,
         (SELECT count(*) FROM public.products p
           WHERE p.category_id = c.id AND p.status = 'publicado'
             AND (p.published_at IS NULL OR p.published_at <= now()))
  FROM public.categories c
  WHERE c.status = 'publicado'
  ORDER BY c.position, c.name;
$$;

CREATE OR REPLACE FUNCTION public.public_catalog_list(
  _category_slug text DEFAULT NULL,
  _collection_slug text DEFAULT NULL,
  _search text DEFAULT NULL,
  _featured boolean DEFAULT NULL,
  _limit integer DEFAULT 24,
  _offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, slug text, name text, short_description text,
  category_slug text, category_name text, collection_slug text,
  price_cents integer, is_featured boolean,
  cover_media_id uuid, cover_alt text, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT p.*, c.slug AS cat_slug, c.name AS cat_name, col.slug AS col_slug
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.collections col ON col.id = p.collection_id
    WHERE p.status = 'publicado'
      AND (p.published_at IS NULL OR p.published_at <= now())
      AND (_category_slug IS NULL OR c.slug = _category_slug)
      AND (_collection_slug IS NULL OR col.slug = _collection_slug)
      AND (_featured IS NULL OR p.is_featured = _featured)
      AND (nullif(btrim(coalesce(_search,'')),'') IS NULL
           OR p.name ILIKE '%'||btrim(_search)||'%'
           OR p.short_description ILIKE '%'||btrim(_search)||'%')
  ), cont AS (SELECT count(*)::bigint AS n FROM base)
  SELECT b.id, b.slug, b.name, b.short_description,
         b.cat_slug, b.cat_name, b.col_slug,
         CASE WHEN b.price_is_public THEN COALESCE(b.price_cents,
              (SELECT v.price_cents FROM public.product_variants v
                WHERE v.product_id = b.id AND v.is_active
                ORDER BY v.is_default DESC, v.position LIMIT 1)) END,
         b.is_featured,
         (SELECT pm.media_id FROM public.product_media pm
           WHERE pm.product_id = b.id ORDER BY pm.position LIMIT 1),
         (SELECT ma.alt FROM public.product_media pm
             JOIN public.media_assets ma ON ma.id = pm.media_id
           WHERE pm.product_id = b.id ORDER BY pm.position LIMIT 1),
         (SELECT n FROM cont)
  FROM base b
  ORDER BY b.is_featured DESC, b.position, b.published_at DESC NULLS LAST
  LIMIT greatest(coalesce(_limit,24),1) OFFSET greatest(coalesce(_offset,0),0);
$$;

CREATE OR REPLACE FUNCTION public.public_product(_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.products; res jsonb;
BEGIN
  SELECT * INTO p FROM public.products
   WHERE slug = _slug AND status = 'publicado'
     AND (published_at IS NULL OR published_at <= now());
  IF NOT FOUND THEN RETURN NULL; END IF;

  res := jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name,
    'short_description', p.short_description, 'description', p.description,
    'material', p.material, 'plating', p.plating, 'measurements', p.measurements,
    'weight_grams', p.weight_grams, 'care_instructions', p.care_instructions,
    'warranty_text', p.warranty_text,
    'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'is_featured', p.is_featured,
    'price_cents', CASE WHEN p.price_is_public THEN COALESCE(p.price_cents,
        (SELECT v.price_cents FROM public.product_variants v
          WHERE v.product_id = p.id AND v.is_active
          ORDER BY v.is_default DESC, v.position LIMIT 1)) END,
    'category', (SELECT jsonb_build_object('slug', c.slug, 'name', c.name)
                   FROM public.categories c WHERE c.id = p.category_id AND c.status = 'publicado'),
    'collection', (SELECT jsonb_build_object('slug', c.slug, 'name', c.name)
                   FROM public.collections c WHERE c.id = p.collection_id AND c.status = 'publicado'),
    'imagens', coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'media_id', ma.id, 'alt', ma.alt, 'position', pm.position)
                    ORDER BY pm.position)
                  FROM public.product_media pm
                  JOIN public.media_assets ma ON ma.id = pm.media_id AND NOT ma.is_archived
                  WHERE pm.product_id = p.id), '[]'::jsonb),
    'variantes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'id', v.id, 'label', v.label, 'size', v.size, 'color', v.color,
                    'price_cents', CASE WHEN p.price_is_public THEN v.price_cents END)
                    ORDER BY v.is_default DESC, v.position)
                  FROM public.product_variants v
                  WHERE v.product_id = p.id AND v.is_active), '[]'::jsonb));
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.public_categories() FROM public;
REVOKE ALL ON FUNCTION public.public_catalog_list(text,text,text,boolean,integer,integer) FROM public;
REVOKE ALL ON FUNCTION public.public_product(text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_categories() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_catalog_list(text,text,text,boolean,integer,integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_product(text) TO anon, authenticated;
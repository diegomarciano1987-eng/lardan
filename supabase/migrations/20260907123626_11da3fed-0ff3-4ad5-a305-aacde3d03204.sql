CREATE OR REPLACE FUNCTION public.taxonomy_publish_blockers(_tipo text, _id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _nome text; _slug text; _desc text; _seo_t text; _seo_d text; _hero uuid;
  _dup boolean := false; _b text[] := ARRAY[]::text[];
BEGIN
  IF _tipo = 'categories' THEN
    SELECT name, slug, description, seo_title, seo_description, hero_media_id
      INTO _nome, _slug, _desc, _seo_t, _seo_d, _hero FROM public.categories WHERE id = _id;
    IF NOT FOUND THEN RETURN ARRAY['inexistente']::text[]; END IF;
    SELECT EXISTS (SELECT 1 FROM public.categories WHERE slug = _slug AND id <> _id) INTO _dup;
  ELSIF _tipo = 'collections' THEN
    SELECT name, slug, description, seo_title, seo_description, hero_media_id
      INTO _nome, _slug, _desc, _seo_t, _seo_d, _hero FROM public.collections WHERE id = _id;
    IF NOT FOUND THEN RETURN ARRAY['inexistente']::text[]; END IF;
    SELECT EXISTS (SELECT 1 FROM public.collections WHERE slug = _slug AND id <> _id) INTO _dup;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;

  IF btrim(coalesce(_nome,'')) = '' THEN _b := _b || 'nome'::text; END IF;
  IF btrim(coalesce(_slug,'')) = '' THEN _b := _b || 'slug'::text;
  ELSIF _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN _b := _b || 'slug_invalido'::text;
  END IF;
  IF _dup THEN _b := _b || 'slug_duplicado'::text; END IF;
  IF btrim(coalesce(_desc,'')) = '' THEN _b := _b || 'descricao'::text; END IF;
  IF btrim(coalesce(_seo_t,'')) = '' THEN _b := _b || 'titulo_publico'::text; END IF;
  IF btrim(coalesce(_seo_d,'')) = '' THEN _b := _b || 'seo'::text; END IF;
  IF _hero IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.media_assets m
       WHERE m.id = _hero AND (btrim(coalesce(m.alt,'')) = '' OR m.is_archived)
  ) THEN _b := _b || 'texto_alternativo'::text; END IF;

  RETURN _b;
END $function$;
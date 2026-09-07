-- =====================================================================
-- P1-B: contrato definitivo da vitrine
-- =====================================================================

-- 1. Histórico de slug -------------------------------------------------
CREATE TABLE public.taxonomy_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('categories','collections')),
  entity_id uuid NOT NULL,
  old_slug text NOT NULL,
  new_slug text NOT NULL,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.taxonomy_slug_history TO authenticated;
GRANT ALL ON public.taxonomy_slug_history TO service_role;

ALTER TABLE public.taxonomy_slug_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipe le historico de slug"
  ON public.taxonomy_slug_history FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE INDEX taxonomy_slug_history_lookup
  ON public.taxonomy_slug_history (entity_type, old_slug, created_at DESC);

CREATE OR REPLACE FUNCTION public.taxonomy_slug_history_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug AND btrim(coalesce(OLD.slug,'')) <> '' THEN
    INSERT INTO public.taxonomy_slug_history (entity_type, entity_id, old_slug, new_slug, changed_by)
    VALUES (TG_ARGV[0], OLD.id, OLD.slug, NEW.slug, auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_categories_slug_history
  AFTER UPDATE OF slug ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.taxonomy_slug_history_log('categories');

CREATE TRIGGER trg_collections_slug_history
  AFTER UPDATE OF slug ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.taxonomy_slug_history_log('collections');

-- Resolução pública de endereço antigo -> endereço atual publicado
CREATE OR REPLACE FUNCTION public.public_taxonomy_redirect(_tipo text, _slug text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _destino text;
BEGIN
  IF _tipo = 'categories' THEN
    SELECT c.slug INTO _destino
      FROM public.taxonomy_slug_history h
      JOIN public.categories c ON c.id = h.entity_id
     WHERE h.entity_type = 'categories' AND h.old_slug = _slug
       AND c.status = 'publicado' AND c.slug <> _slug
     ORDER BY h.created_at DESC LIMIT 1;
  ELSIF _tipo = 'collections' THEN
    SELECT c.slug INTO _destino
      FROM public.taxonomy_slug_history h
      JOIN public.collections c ON c.id = h.entity_id
     WHERE h.entity_type = 'collections' AND h.old_slug = _slug
       AND c.status = 'publicado' AND c.slug <> _slug
     ORDER BY h.created_at DESC LIMIT 1;
  END IF;
  RETURN _destino;
END $$;

REVOKE ALL ON FUNCTION public.taxonomy_slug_history_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_taxonomy_redirect(text, text) TO anon, authenticated;

-- 2. Contrato de publicação de categoria/coleção -----------------------
CREATE OR REPLACE FUNCTION public.taxonomy_publish_blockers(_tipo text, _id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _nome text; _slug text; _desc text; _seo_t text; _seo_d text; _hero uuid;
  _dup boolean := false; _b text[] := ARRAY[]::text[];
BEGIN
  IF _tipo = 'categories' THEN
    SELECT name, slug, description, seo_title, seo_description, hero_media_id
      INTO _nome, _slug, _desc, _seo_t, _seo_d, _hero FROM public.categories WHERE id = _id;
    IF NOT FOUND THEN RETURN ARRAY['inexistente']; END IF;
    SELECT EXISTS (SELECT 1 FROM public.categories WHERE slug = _slug AND id <> _id) INTO _dup;
  ELSIF _tipo = 'collections' THEN
    SELECT name, slug, description, seo_title, seo_description, hero_media_id
      INTO _nome, _slug, _desc, _seo_t, _seo_d, _hero FROM public.collections WHERE id = _id;
    IF NOT FOUND THEN RETURN ARRAY['inexistente']; END IF;
    SELECT EXISTS (SELECT 1 FROM public.collections WHERE slug = _slug AND id <> _id) INTO _dup;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;

  IF btrim(coalesce(_nome,'')) = '' THEN _b := _b || 'nome'; END IF;
  IF btrim(coalesce(_slug,'')) = '' THEN _b := _b || 'slug';
  ELSIF _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN _b := _b || 'slug_invalido';
  END IF;
  IF _dup THEN _b := _b || 'slug_duplicado'; END IF;
  IF btrim(coalesce(_desc,'')) = '' THEN _b := _b || 'descricao'; END IF;
  IF btrim(coalesce(_seo_t,'')) = '' THEN _b := _b || 'titulo_publico'; END IF;
  IF btrim(coalesce(_seo_d,'')) = '' THEN _b := _b || 'seo'; END IF;
  IF _hero IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.media_assets m
       WHERE m.id = _hero AND (btrim(coalesce(m.alt,'')) = '' OR m.is_archived)
  ) THEN _b := _b || 'texto_alternativo'; END IF;

  RETURN _b;
END $$;

GRANT EXECUTE ON FUNCTION public.taxonomy_publish_blockers(text, uuid) TO authenticated;

-- Guarda permanente: só a porta canônica muda o estado publicado
CREATE OR REPLACE FUNCTION public.taxonomy_publish_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('lardan.publicacao', true), '') = 'canonica' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'publicado'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'publicado') THEN
    RAISE EXCEPTION 'Publicação só é possível pela operação canônica publish_taxonomy (com permissão e conteúdo completo).'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicado' AND NEW.status IS DISTINCT FROM 'publicado' THEN
    RAISE EXCEPTION 'Retirar do ar só é possível pela operação canônica unpublish_taxonomy (com motivo e decisão sobre os produtos).'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'publicado' AND OLD.status = 'publicado' THEN
    IF btrim(coalesce(NEW.name,'')) = ''
       OR btrim(coalesce(NEW.slug,'')) = ''
       OR btrim(coalesce(NEW.description,'')) = ''
       OR btrim(coalesce(NEW.seo_title,'')) = '' THEN
      RAISE EXCEPTION 'Registro publicado não pode ficar sem nome, endereço, descrição ou título público. Retire do ar antes de esvaziar.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_categories_publish_guard
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.taxonomy_publish_guard();

CREATE TRIGGER trg_collections_publish_guard
  BEFORE INSERT OR UPDATE ON public.collections
  FOR EACH ROW EXECUTE FUNCTION public.taxonomy_publish_guard();

-- Dependentes publicados
CREATE OR REPLACE FUNCTION public.taxonomy_dependents(_tipo text, _id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _pub integer := 0; _tot integer := 0;
BEGIN
  IF _tipo = 'categories' THEN
    SELECT count(*) FILTER (WHERE status = 'publicado'), count(*)
      INTO _pub, _tot FROM public.products WHERE category_id = _id;
  ELSIF _tipo = 'collections' THEN
    SELECT count(*) FILTER (WHERE status = 'publicado'), count(*)
      INTO _pub, _tot FROM public.products WHERE collection_id = _id;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;
  RETURN jsonb_build_object('produtos_publicados', _pub, 'produtos_total', _tot);
END $$;

GRANT EXECUTE ON FUNCTION public.taxonomy_dependents(text, uuid) TO authenticated;

-- Publicar
CREATE OR REPLACE FUNCTION public.publish_taxonomy(_tipo text, _ids uuid[], _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _bloqueados jsonb := '[]'::jsonb;
  _aptos uuid[] := ARRAY[]::uuid[];
  _afetados integer := 0;
  _id uuid; _falta text[]; _nome text;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'showcase.publish')
          OR public.has_capability(auth.uid(),'catalog.publish')) THEN
    RAISE EXCEPTION 'Sem permissão para publicar.' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('categories','collections') THEN
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;
  IF cardinality(_alvos) = 0 THEN
    RETURN jsonb_build_object('afetados', 0, 'rejeitados', 0, 'itens_rejeitados', '[]'::jsonb);
  END IF;

  FOREACH _id IN ARRAY _alvos LOOP
    _falta := public.taxonomy_publish_blockers(_tipo, _id);
    IF cardinality(_falta) = 0 THEN
      _aptos := _aptos || _id;
    ELSE
      IF _tipo = 'categories' THEN SELECT name INTO _nome FROM public.categories WHERE id = _id;
      ELSE SELECT name INTO _nome FROM public.collections WHERE id = _id; END IF;
      _bloqueados := _bloqueados || jsonb_build_object('id', _id, 'nome', coalesce(_nome,''), 'faltando', to_jsonb(_falta));
    END IF;
  END LOOP;

  IF cardinality(_aptos) > 0 THEN
    PERFORM set_config('lardan.publicacao', 'canonica', true);
    IF _tipo = 'categories' THEN
      UPDATE public.categories SET status = 'publicado',
             published_at = coalesce(published_at, now()), updated_at = now()
       WHERE id = ANY(_aptos) AND status IS DISTINCT FROM 'publicado';
    ELSE
      UPDATE public.collections SET status = 'publicado',
             published_at = coalesce(published_at, now()), updated_at = now()
       WHERE id = ANY(_aptos) AND status IS DISTINCT FROM 'publicado';
    END IF;
    GET DIAGNOSTICS _afetados = ROW_COUNT;
    PERFORM set_config('lardan.publicacao', '', true);

    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    SELECT auth.uid(), 'vitrine.publicar_taxonomia', _tipo, tid::text,
           jsonb_build_object('motivo', _note)
      FROM unnest(_aptos) AS tid;
  END IF;

  RETURN jsonb_build_object('afetados', _afetados,
    'rejeitados', jsonb_array_length(_bloqueados), 'itens_rejeitados', _bloqueados);
END $$;

GRANT EXECUTE ON FUNCTION public.publish_taxonomy(text, uuid[], text) TO authenticated;

-- Despublicar / arquivar
CREATE OR REPLACE FUNCTION public.unpublish_taxonomy(
  _tipo text, _ids uuid[], _note text,
  _para text DEFAULT 'rascunho', _produtos text DEFAULT 'bloquear')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _afetados integer := 0;
  _dep uuid[]; _dep_total integer := 0; _mudados uuid[];
BEGIN
  IF NOT (public.has_capability(auth.uid(),'showcase.publish')
          OR public.has_capability(auth.uid(),'catalog.publish')) THEN
    RAISE EXCEPTION 'Sem permissão para retirar do ar.' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('categories','collections') THEN
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;
  IF btrim(coalesce(_note,'')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo para retirar do ar.' USING ERRCODE = '23514';
  END IF;
  IF _para NOT IN ('rascunho','revisao','arquivado') THEN
    RAISE EXCEPTION 'Destino inválido: %', _para;
  END IF;
  IF _produtos NOT IN ('bloquear','despublicar') THEN
    RAISE EXCEPTION 'Decisão inválida para os produtos: %', _produtos;
  END IF;
  IF cardinality(_alvos) = 0 THEN
    RETURN jsonb_build_object('afetados', 0, 'produtos_afetados', 0);
  END IF;

  IF _tipo = 'categories' THEN
    SELECT array_agg(id) INTO _dep FROM public.products
     WHERE category_id = ANY(_alvos) AND status = 'publicado';
  ELSE
    SELECT array_agg(id) INTO _dep FROM public.products
     WHERE collection_id = ANY(_alvos) AND status = 'publicado';
  END IF;
  _dep := coalesce(_dep, ARRAY[]::uuid[]);
  _dep_total := cardinality(_dep);

  IF _dep_total > 0 THEN
    IF _produtos = 'bloquear' THEN
      RAISE EXCEPTION 'Existem % produto(s) publicado(s) dependentes. Decida o que fazer com eles antes de retirar do ar.', _dep_total
        USING ERRCODE = '23503';
    END IF;
    PERFORM public.unpublish_products(_dep, _note, 'rascunho');
  END IF;

  PERFORM set_config('lardan.publicacao', 'canonica', true);
  IF _tipo = 'categories' THEN
    WITH alterados AS (
      UPDATE public.categories SET status = _para::content_status, updated_at = now()
       WHERE id = ANY(_alvos) AND status = 'publicado' RETURNING id)
    SELECT array_agg(id) INTO _mudados FROM alterados;
  ELSE
    WITH alterados AS (
      UPDATE public.collections SET status = _para::content_status, updated_at = now()
       WHERE id = ANY(_alvos) AND status = 'publicado' RETURNING id)
    SELECT array_agg(id) INTO _mudados FROM alterados;
  END IF;
  PERFORM set_config('lardan.publicacao', '', true);

  _mudados := coalesce(_mudados, ARRAY[]::uuid[]);
  _afetados := cardinality(_mudados);

  IF _afetados > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    SELECT auth.uid(), 'vitrine.despublicar_taxonomia', _tipo, tid::text,
           jsonb_build_object('motivo', _note, 'destino', _para,
                              'produtos_despublicados', _dep_total)
      FROM unnest(_mudados) AS tid;
  END IF;

  RETURN jsonb_build_object('afetados', _afetados, 'produtos_afetados', _dep_total);
END $$;

GRANT EXECUTE ON FUNCTION public.unpublish_taxonomy(text, uuid[], text, text, text) TO authenticated;

-- Reordenar
CREATE OR REPLACE FUNCTION public.taxonomy_reorder(_tipo text, _ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _afetados integer := 0;
BEGIN
  IF NOT public.can_manage_content(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para reordenar.' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('categories','collections') THEN
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;

  IF _tipo = 'categories' THEN
    UPDATE public.categories c SET position = o.ord, updated_at = now()
      FROM (SELECT id, ordinality::int AS ord FROM unnest(_ids) WITH ORDINALITY AS t(id, ordinality)) o
     WHERE c.id = o.id;
  ELSE
    UPDATE public.collections c SET position = o.ord, updated_at = now()
      FROM (SELECT id, ordinality::int AS ord FROM unnest(_ids) WITH ORDINALITY AS t(id, ordinality)) o
     WHERE c.id = o.id;
  END IF;
  GET DIAGNOSTICS _afetados = ROW_COUNT;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'vitrine.reordenar_taxonomia', _tipo, NULL,
          jsonb_build_object('ordem', to_jsonb(_ids)));

  RETURN jsonb_build_object('afetados', _afetados);
END $$;

GRANT EXECUTE ON FUNCTION public.taxonomy_reorder(text, uuid[]) TO authenticated;

-- Conteúdo público (inclui troca de endereço com histórico)
CREATE OR REPLACE FUNCTION public.taxonomy_save_public(_tipo text, _id uuid, _values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _slug text; _dup boolean;
BEGIN
  IF NOT public.can_manage_content(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para editar a vitrine.' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('categories','collections') THEN
    RAISE EXCEPTION 'Tipo inválido: %', _tipo;
  END IF;

  _slug := nullif(btrim(coalesce(_values->>'slug','')), '');
  IF _slug IS NOT NULL THEN
    IF _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'Endereço inválido: use apenas letras minúsculas, números e hífen.' USING ERRCODE = '23514';
    END IF;
    IF _tipo = 'categories' THEN
      SELECT EXISTS (SELECT 1 FROM public.categories WHERE slug = _slug AND id <> _id) INTO _dup;
    ELSE
      SELECT EXISTS (SELECT 1 FROM public.collections WHERE slug = _slug AND id <> _id) INTO _dup;
    END IF;
    IF _dup THEN
      RAISE EXCEPTION 'Já existe outro registro com este endereço.' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF _tipo = 'categories' THEN
    UPDATE public.categories SET
      name = coalesce(nullif(btrim(coalesce(_values->>'name','')),''), name),
      slug = coalesce(_slug, slug),
      description = CASE WHEN _values ? 'description' THEN nullif(btrim(coalesce(_values->>'description','')),'') ELSE description END,
      seo_title = CASE WHEN _values ? 'seo_title' THEN nullif(btrim(coalesce(_values->>'seo_title','')),'') ELSE seo_title END,
      seo_description = CASE WHEN _values ? 'seo_description' THEN nullif(btrim(coalesce(_values->>'seo_description','')),'') ELSE seo_description END,
      hero_media_id = CASE WHEN _values ? 'hero_media_id' THEN nullif(_values->>'hero_media_id','')::uuid ELSE hero_media_id END,
      updated_at = now()
    WHERE id = _id;
  ELSE
    UPDATE public.collections SET
      name = coalesce(nullif(btrim(coalesce(_values->>'name','')),''), name),
      slug = coalesce(_slug, slug),
      description = CASE WHEN _values ? 'description' THEN nullif(btrim(coalesce(_values->>'description','')),'') ELSE description END,
      seo_title = CASE WHEN _values ? 'seo_title' THEN nullif(btrim(coalesce(_values->>'seo_title','')),'') ELSE seo_title END,
      seo_description = CASE WHEN _values ? 'seo_description' THEN nullif(btrim(coalesce(_values->>'seo_description','')),'') ELSE seo_description END,
      hero_media_id = CASE WHEN _values ? 'hero_media_id' THEN nullif(_values->>'hero_media_id','')::uuid ELSE hero_media_id END,
      updated_at = now()
    WHERE id = _id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.taxonomy_save_public(text, uuid, jsonb) TO authenticated;

-- 3. Invariantes permanentes do produto publicado ----------------------
CREATE OR REPLACE FUNCTION public.products_publish_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _canonica boolean := coalesce(current_setting('lardan.publicacao', true), '') = 'canonica';
BEGIN
  IF NEW.status = 'publicado'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'publicado')
     AND NOT _canonica THEN
    RAISE EXCEPTION 'Publicação só é possível pela operação canônica publish_products (com permissão e checklist completo).'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicado'
     AND NEW.status IS DISTINCT FROM 'publicado' AND NOT _canonica THEN
    RAISE EXCEPTION 'Retirar a peça do ar só é possível pela operação canônica unpublish_products (com motivo).'
      USING ERRCODE = '42501';
  END IF;

  -- enquanto estiver publicado, o conteúdo mínimo não pode se desfazer
  IF TG_OP = 'UPDATE' AND NEW.status = 'publicado' AND OLD.status = 'publicado' THEN
    IF btrim(coalesce(NEW.name,'')) = '' THEN
      RAISE EXCEPTION 'Peça publicada não pode ficar sem nome. Retire do ar antes.' USING ERRCODE = '23514';
    END IF;
    IF btrim(coalesce(NEW.slug,'')) = '' THEN
      RAISE EXCEPTION 'Peça publicada não pode ficar sem endereço de página. Retire do ar antes.' USING ERRCODE = '23514';
    END IF;
    IF btrim(coalesce(NEW.description,'')) = '' THEN
      RAISE EXCEPTION 'Peça publicada não pode ficar sem descrição. Retire do ar antes.' USING ERRCODE = '23514';
    END IF;
    IF NEW.category_id IS NULL THEN
      RAISE EXCEPTION 'Peça publicada não pode ficar sem categoria. Retire do ar antes.' USING ERRCODE = '23514';
    END IF;
    IF NEW.price_is_public AND coalesce(NEW.price_cents,0) <= 0 THEN
      RAISE EXCEPTION 'Peça publicada com preço visível precisa ter preço. Retire do ar ou esconda o preço antes.' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.products o
                WHERE o.slug = NEW.slug AND o.id <> NEW.id) THEN
      RAISE EXCEPTION 'Já existe outra peça com este endereço de página.' USING ERRCODE = '23505';
    END IF;
    IF NEW.category_id IS DISTINCT FROM OLD.category_id AND NOT EXISTS (
      SELECT 1 FROM public.categories c WHERE c.id = NEW.category_id AND c.status = 'publicado'
    ) THEN
      RAISE EXCEPTION 'A categoria escolhida não está publicada. Peça publicada não pode apontar para categoria invisível.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- imagem: não some a última foto de peça publicada
CREATE OR REPLACE FUNCTION public.product_media_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _pid uuid := coalesce(OLD.product_id, NEW.product_id); _restantes integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = _pid AND p.status = 'publicado') THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  SELECT count(*) INTO _restantes
    FROM public.product_media pm JOIN public.media_assets ma ON ma.id = pm.media_id
   WHERE pm.product_id = _pid AND coalesce(ma.is_archived,false) = false
     AND pm.id <> coalesce(OLD.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF _restantes = 0 THEN
    RAISE EXCEPTION 'Peça publicada não pode ficar sem imagem. Retire do ar antes de remover a última foto.'
      USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER trg_product_media_guard
  BEFORE DELETE ON public.product_media
  FOR EACH ROW EXECUTE FUNCTION public.product_media_guard();

-- mídia: não arquiva nem esvazia o alt de imagem usada por peça publicada
CREATE OR REPLACE FUNCTION public.media_assets_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _em_uso boolean; _ultima boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.product_media pm JOIN public.products p ON p.id = pm.product_id
     WHERE pm.media_id = NEW.id AND p.status = 'publicado'
  ) OR EXISTS (
    SELECT 1 FROM public.categories c WHERE c.hero_media_id = NEW.id AND c.status = 'publicado'
  ) OR EXISTS (
    SELECT 1 FROM public.collections c WHERE c.hero_media_id = NEW.id AND c.status = 'publicado'
  ) INTO _em_uso;

  IF NOT _em_uso THEN RETURN NEW; END IF;

  IF btrim(coalesce(NEW.alt,'')) = '' AND btrim(coalesce(OLD.alt,'')) <> '' THEN
    RAISE EXCEPTION 'Imagem no ar não pode ficar sem texto alternativo.' USING ERRCODE = '23514';
  END IF;

  IF NEW.is_archived AND NOT OLD.is_archived THEN
    SELECT EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.status = 'publicado'
         AND EXISTS (SELECT 1 FROM public.product_media pm WHERE pm.product_id = p.id AND pm.media_id = NEW.id)
         AND NOT EXISTS (
           SELECT 1 FROM public.product_media pm2 JOIN public.media_assets m2 ON m2.id = pm2.media_id
            WHERE pm2.product_id = p.id AND pm2.media_id <> NEW.id AND coalesce(m2.is_archived,false) = false)
    ) OR EXISTS (SELECT 1 FROM public.categories c WHERE c.hero_media_id = NEW.id AND c.status = 'publicado')
      OR EXISTS (SELECT 1 FROM public.collections c WHERE c.hero_media_id = NEW.id AND c.status = 'publicado')
    INTO _ultima;
    IF _ultima THEN
      RAISE EXCEPTION 'Esta imagem está no ar e é a única disponível. Retire a peça ou a categoria do ar antes de arquivar.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_media_assets_guard
  BEFORE UPDATE ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.media_assets_guard();

-- variantes: não some a última variante ativa de peça publicada
CREATE OR REPLACE FUNCTION public.product_variants_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _pid uuid := coalesce(OLD.product_id, NEW.product_id); _restantes integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = _pid AND p.status = 'publicado') THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.is_active OR OLD.is_active = false) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _restantes FROM public.product_variants v
   WHERE v.product_id = _pid AND v.is_active AND v.id <> OLD.id;

  IF _restantes = 0 THEN
    RAISE EXCEPTION 'Peça publicada precisa de pelo menos uma variante ativa. Retire do ar antes.'
      USING ERRCODE = '23514';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER trg_product_variants_guard
  BEFORE UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.product_variants_guard();

-- 4. Despublicação honesta de produtos ---------------------------------
CREATE OR REPLACE FUNCTION public.unpublish_products(_ids uuid[], _note text DEFAULT NULL::text, _para text DEFAULT 'rascunho'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _mudados uuid[];
  _afetados integer := 0;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'showcase.publish')
          OR public.has_capability(auth.uid(),'catalog.publish')) THEN
    RAISE EXCEPTION 'Sem permissão para despublicar.' USING ERRCODE = '42501';
  END IF;
  IF _para NOT IN ('rascunho','revisao','arquivado') THEN
    RAISE EXCEPTION 'Destino inválido para despublicação: %', _para;
  END IF;
  IF cardinality(_alvos) = 0 THEN
    RETURN jsonb_build_object('afetados', 0);
  END IF;
  IF btrim(coalesce(_note,'')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo para retirar do ar.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('lardan.publicacao', 'canonica', true);
  WITH alterados AS (
    UPDATE products
       SET status = _para::content_status, scheduled_publish_at = NULL, updated_at = now()
     WHERE id = ANY(_alvos) AND status = 'publicado'
     RETURNING id)
  SELECT array_agg(id) INTO _mudados FROM alterados;
  PERFORM set_config('lardan.publicacao', '', true);

  _mudados := coalesce(_mudados, ARRAY[]::uuid[]);
  _afetados := cardinality(_mudados);

  IF _afetados > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    SELECT auth.uid(), 'catalogo.despublicar', 'products', pid::text,
           jsonb_build_object('motivo', _note, 'destino', _para)
      FROM unnest(_mudados) AS pid;
  END IF;

  RETURN jsonb_build_object('afetados', _afetados);
END $$;
-- ============ 1. Schema ============
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_new_arrival boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS stock_visibility text NOT NULL DEFAULT 'manter_visivel';

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_stock_visibility_chk
    CHECK (stock_visibility IN ('ocultar_ao_zerar','manter_visivel','consulta','institucional'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_products_status ON public.products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_collection ON public.products(collection_id);
CREATE INDEX IF NOT EXISTS idx_products_updated ON public.products(updated_at DESC);

-- ============ 2. Visões salvas ============
CREATE TABLE IF NOT EXISTS public.showcase_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcase_views TO authenticated;
GRANT ALL ON public.showcase_views TO service_role;
ALTER TABLE public.showcase_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "views visiveis para o time de conteudo" ON public.showcase_views
  FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()) AND (is_shared OR created_by = auth.uid()));
CREATE POLICY "views geridas pelo autor" ON public.showcase_views
  FOR ALL TO authenticated
  USING (public.can_manage_content(auth.uid()) AND created_by = auth.uid())
  WITH CHECK (public.can_manage_content(auth.uid()) AND created_by = auth.uid());
CREATE TRIGGER showcase_views_updated_at BEFORE UPDATE ON public.showcase_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ 3. Lotes de ação em massa ============
CREATE TABLE IF NOT EXISTS public.showcase_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected integer NOT NULL DEFAULT 0,
  rejected integer NOT NULL DEFAULT 0,
  rejected_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.showcase_batches TO authenticated;
GRANT ALL ON public.showcase_batches TO service_role;
ALTER TABLE public.showcase_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lotes visiveis para conteudo e auditoria" ON public.showcase_batches
  FOR SELECT TO authenticated
  USING (public.can_manage_content(auth.uid()) OR public.has_capability(auth.uid(),'audit.view'));

-- ============ 4. Permissões ============
INSERT INTO public.role_capabilities (role, capability)
SELECT r::app_role, c
FROM unnest(ARRAY['master','diretoria','marketing']) r,
     unnest(ARRAY['showcase.view','showcase.publish','showcase.bulk','showcase.home','showcase.schedule']) c
ON CONFLICT DO NOTHING;

-- ============ 5. Contadores reais ============
CREATE OR REPLACE FUNCTION public.showcase_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT p.id, p.status, p.price_cents, p.category_id, p.is_featured,
           p.scheduled_publish_at, p.updated_at, p.description, p.slug, p.name,
           EXISTS (SELECT 1 FROM product_media pm WHERE pm.product_id = p.id) AS tem_imagem,
           COALESCE((
             SELECT SUM(sb.quantity) FROM stock_balances sb
             JOIN product_variants v ON v.id = sb.variant_id
             WHERE v.product_id = p.id), 0) AS estoque
    FROM products p
    WHERE public.can_manage_content(auth.uid()) OR public.has_capability(auth.uid(),'catalog.view')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'publicados', (SELECT count(*) FROM base WHERE status = 'publicado'),
    'aguardando', (SELECT count(*) FROM base WHERE status IN ('rascunho','revisao')),
    'incompletos', (SELECT count(*) FROM base WHERE NOT tem_imagem OR category_id IS NULL
                      OR description IS NULL OR btrim(coalesce(description,'')) = ''),
    'sem_imagem', (SELECT count(*) FROM base WHERE NOT tem_imagem),
    'sem_preco', (SELECT count(*) FROM base WHERE price_cents IS NULL),
    'sem_categoria', (SELECT count(*) FROM base WHERE category_id IS NULL),
    'sem_estoque', (SELECT count(*) FROM base WHERE estoque <= 0),
    'destaques', (SELECT count(*) FROM base WHERE is_featured),
    'agendados', (SELECT count(*) FROM base WHERE scheduled_publish_at IS NOT NULL AND status <> 'publicado'),
    'alterados_7d', (SELECT count(*) FROM base WHERE updated_at > now() - interval '7 days')
  );
$$;
REVOKE ALL ON FUNCTION public.showcase_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_counts() TO authenticated;

-- ============ 6. Listagem no servidor ============
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
      (_busca IS NULL OR (
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
  LIMIT greatest(1, least(_limit, 200)) OFFSET greatest(0, _offset);
END;
$$;
REVOKE ALL ON FUNCTION public.showcase_list(jsonb, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_list(jsonb, text, integer, integer) TO authenticated;

-- ============ 7. Ações em massa ============
CREATE OR REPLACE FUNCTION public.showcase_bulk(
  _action text, _ids uuid[], _params jsonb DEFAULT '{}'::jsonb,
  _filters jsonb DEFAULT '{}'::jsonb, _idempotency_key text DEFAULT NULL, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _key text := coalesce(nullif(btrim(coalesce(_idempotency_key,'')), ''), gen_random_uuid()::text);
  _existing public.showcase_batches;
  _alvos uuid[];
  _bloqueados jsonb := '[]'::jsonb;
  _afetados integer := 0;
  _publica boolean := _action IN ('publicar','despublicar','programar','cancelar_agendamento','arquivar');
BEGIN
  IF NOT public.can_manage_content(auth.uid()) THEN
    RAISE EXCEPTION 'sem permissao para acoes em massa na vitrine';
  END IF;
  IF _publica AND NOT public.has_capability(auth.uid(),'showcase.publish') THEN
    RAISE EXCEPTION 'sem permissao para publicar';
  END IF;

  SELECT * INTO _existing FROM showcase_batches WHERE idempotency_key = _key;
  IF FOUND THEN
    RETURN jsonb_build_object('lote_id', _existing.id, 'afetados', _existing.affected,
      'rejeitados', _existing.rejected, 'itens_rejeitados', _existing.rejected_items, 'repetido', true);
  END IF;

  _alvos := coalesce(_ids, ARRAY[]::uuid[]);

  IF _action = 'publicar' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.name, 'faltando', l.faltando)), '[]'::jsonb)
      INTO _bloqueados
      FROM showcase_list(jsonb_build_object(), 'nome_asc', 200, 0) l
      WHERE l.id = ANY(_alvos) AND cardinality(l.faltando) > 0
        AND l.faltando && ARRAY['nome','slug','categoria','descricao','imagem','texto_alternativo','preco'];
    _alvos := ARRAY(SELECT unnest(_alvos) EXCEPT SELECT (e->>'id')::uuid FROM jsonb_array_elements(_bloqueados) e);
  END IF;

  IF cardinality(_alvos) > 0 THEN
    CASE _action
      WHEN 'publicar' THEN
        UPDATE products SET status = 'publicado', published_at = coalesce(published_at, now()),
          scheduled_publish_at = NULL, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'despublicar' THEN
        UPDATE products SET status = 'rascunho', updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'arquivar' THEN
        UPDATE products SET status = 'arquivado', updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'mostrar_preco' THEN
        UPDATE products SET price_is_public = true, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'esconder_preco' THEN
        UPDATE products SET price_is_public = false, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'definir_categoria' THEN
        UPDATE products SET category_id = (_params->>'categoria_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'adicionar_colecao' THEN
        UPDATE products SET collection_id = (_params->>'colecao_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'remover_colecao' THEN
        UPDATE products SET collection_id = NULL, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'destacar' THEN
        UPDATE products SET is_featured = true, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'remover_destaque' THEN
        UPDATE products SET is_featured = false, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'lancamento' THEN
        UPDATE products SET is_new_arrival = true, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'remover_lancamento' THEN
        UPDATE products SET is_new_arrival = false, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'programar' THEN
        UPDATE products SET scheduled_publish_at = (_params->>'quando')::timestamptz, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'cancelar_agendamento' THEN
        UPDATE products SET scheduled_publish_at = NULL, updated_at = now() WHERE id = ANY(_alvos);
      WHEN 'estoque_visibilidade' THEN
        UPDATE products SET stock_visibility = (_params->>'estrategia'), updated_at = now() WHERE id = ANY(_alvos);
      ELSE RAISE EXCEPTION 'acao desconhecida: %', _action;
    END CASE;
    GET DIAGNOSTICS _afetados = ROW_COUNT;
  END IF;

  INSERT INTO showcase_batches (idempotency_key, action, params, filters, affected, rejected, rejected_items, note, actor_id)
  VALUES (_key, _action, coalesce(_params,'{}'::jsonb), coalesce(_filters,'{}'::jsonb), _afetados,
          jsonb_array_length(_bloqueados), _bloqueados, _note, auth.uid())
  RETURNING * INTO _existing;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'vitrine.' || _action, 'products', _existing.id::text,
          jsonb_build_object('afetados', _afetados, 'rejeitados', jsonb_array_length(_bloqueados),
            'filtros', coalesce(_filters,'{}'::jsonb), 'params', coalesce(_params,'{}'::jsonb),
            'ids', to_jsonb(_alvos), 'chave', _key));

  RETURN jsonb_build_object('lote_id', _existing.id, 'afetados', _afetados,
    'rejeitados', jsonb_array_length(_bloqueados), 'itens_rejeitados', _bloqueados, 'repetido', false);
END;
$$;
REVOKE ALL ON FUNCTION public.showcase_bulk(text, uuid[], jsonb, jsonb, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_bulk(text, uuid[], jsonb, jsonb, text, text) TO authenticated;

-- ============ 8. IDs de um filtro (seleção do conjunto completo) ============
CREATE OR REPLACE FUNCTION public.showcase_ids(_f jsonb DEFAULT '{}'::jsonb, _max integer DEFAULT 5000)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(l.id), ARRAY[]::uuid[])
  FROM showcase_list(_f, 'nome_asc', 200, 0) l;
$$;
REVOKE ALL ON FUNCTION public.showcase_ids(jsonb, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.showcase_ids(jsonb, integer) TO authenticated;
-- =====================================================================
-- R0.1 — Publicação canônica  |  R0.2 (parte 1) — privacidade
-- Aditivo: nada é apagado, nenhuma migração anterior é alterada.
-- =====================================================================

-- ---------- Impedimentos calculados no servidor ----------

CREATE OR REPLACE FUNCTION public.product_publish_blockers(_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN btrim(coalesce(p.name,'')) = '' THEN 'nome' END,
    CASE WHEN btrim(coalesce(p.slug,'')) = '' THEN 'slug' END,
    CASE WHEN p.category_id IS NULL THEN 'categoria' END,
    CASE WHEN p.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM categories c WHERE c.id = p.category_id AND c.status = 'publicado'
    ) THEN 'categoria_nao_publicada' END,
    CASE WHEN btrim(coalesce(p.description,'')) = '' THEN 'descricao' END,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
       WHERE pm.product_id = p.id AND coalesce(ma.is_archived,false) = false
    ) THEN 'imagem' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM product_media pm JOIN media_assets ma ON ma.id = pm.media_id
       WHERE pm.product_id = p.id AND coalesce(ma.is_archived,false) = false
       AND btrim(coalesce(ma.alt,'')) = ''
    ) THEN 'texto_alternativo' END,
    CASE WHEN p.price_is_public AND coalesce(p.price_cents,0) <= 0 THEN 'preco' END
  ], NULL)
  FROM products p WHERE p.id = _id;
$$;

REVOKE ALL ON FUNCTION public.product_publish_blockers(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.product_publish_blockers(uuid) TO authenticated;

-- ---------- Guarda: nenhum atalho para 'publicado' ----------

CREATE OR REPLACE FUNCTION public.products_publish_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'publicado'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'publicado')
     AND coalesce(current_setting('lardan.publicacao', true), '') <> 'canonica' THEN
    RAISE EXCEPTION 'Publicação só é possível pela operação canônica publish_products (com permissão e checklist completo).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_publish_guard ON public.products;
CREATE TRIGGER trg_products_publish_guard
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_publish_guard();

-- ---------- Operação canônica de publicação ----------

CREATE OR REPLACE FUNCTION public.publish_products(_ids uuid[], _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]);
  _bloqueados jsonb := '[]'::jsonb;
  _aptos uuid[];
  _afetados integer := 0;
BEGIN
  IF NOT (public.has_capability(auth.uid(),'showcase.publish')
          OR public.has_capability(auth.uid(),'catalog.publish')) THEN
    RAISE EXCEPTION 'Sem permissão para publicar.' USING ERRCODE = '42501';
  END IF;

  IF cardinality(_alvos) = 0 THEN
    RETURN jsonb_build_object('afetados', 0, 'rejeitados', 0, 'itens_rejeitados', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'faltando', b.faltando)), '[]'::jsonb)
    INTO _bloqueados
    FROM products p
    CROSS JOIN LATERAL (SELECT public.product_publish_blockers(p.id) AS faltando) b
   WHERE p.id = ANY(_alvos) AND cardinality(b.faltando) > 0;

  _aptos := ARRAY(
    SELECT p.id FROM products p
     WHERE p.id = ANY(_alvos)
       AND cardinality(public.product_publish_blockers(p.id)) = 0
  );

  IF cardinality(_aptos) > 0 THEN
    PERFORM set_config('lardan.publicacao', 'canonica', true);
    UPDATE products
       SET status = 'publicado',
           published_at = coalesce(published_at, now()),
           scheduled_publish_at = NULL,
           updated_at = now()
     WHERE id = ANY(_aptos);
    GET DIAGNOSTICS _afetados = ROW_COUNT;
    PERFORM set_config('lardan.publicacao', '', true);

    INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
    SELECT auth.uid(), 'catalogo.publicar', 'products', pid::text,
           jsonb_build_object('motivo', _note)
      FROM unnest(_aptos) AS pid;
  END IF;

  RETURN jsonb_build_object(
    'afetados', _afetados,
    'rejeitados', jsonb_array_length(_bloqueados),
    'itens_rejeitados', _bloqueados);
END $$;

REVOKE ALL ON FUNCTION public.publish_products(uuid[], text) FROM public;
GRANT EXECUTE ON FUNCTION public.publish_products(uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_products(
  _ids uuid[], _note text DEFAULT NULL, _para text DEFAULT 'rascunho')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _alvos uuid[] := coalesce(_ids, ARRAY[]::uuid[]); _afetados integer := 0;
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

  UPDATE products
     SET status = _para::content_status, scheduled_publish_at = NULL, updated_at = now()
   WHERE id = ANY(_alvos);
  GET DIAGNOSTICS _afetados = ROW_COUNT;

  INSERT INTO audit_logs (actor_id, action, entity, entity_id, payload)
  SELECT auth.uid(), 'catalogo.despublicar', 'products', pid::text,
         jsonb_build_object('motivo', _note, 'destino', _para)
    FROM unnest(_alvos) AS pid;

  RETURN jsonb_build_object('afetados', _afetados);
END $$;

REVOKE ALL ON FUNCTION public.unpublish_products(uuid[], text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.unpublish_products(uuid[], text, text) TO authenticated;

-- ---------- Ações em massa passam a usar a operação canônica ----------

CREATE OR REPLACE FUNCTION public.showcase_bulk(_action text, _ids uuid[], _params jsonb DEFAULT '{}'::jsonb, _filters jsonb DEFAULT '{}'::jsonb, _idempotency_key text DEFAULT NULL::text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _key text := coalesce(nullif(btrim(coalesce(_idempotency_key,'')), ''), gen_random_uuid()::text);
  _existing public.showcase_batches;
  _alvos uuid[];
  _bloqueados jsonb := '[]'::jsonb;
  _afetados integer := 0;
  _res jsonb;
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

  IF cardinality(_alvos) > 0 THEN
    CASE _action
      WHEN 'publicar' THEN
        _res := public.publish_products(_alvos, _note);
        _afetados := (_res->>'afetados')::int;
        _bloqueados := _res->'itens_rejeitados';
      WHEN 'despublicar' THEN
        _res := public.unpublish_products(_alvos, _note, 'rascunho');
        _afetados := (_res->>'afetados')::int;
      WHEN 'arquivar' THEN
        _res := public.unpublish_products(_alvos, _note, 'arquivado');
        _afetados := (_res->>'afetados')::int;
      WHEN 'mostrar_preco' THEN
        UPDATE products SET price_is_public = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'esconder_preco' THEN
        UPDATE products SET price_is_public = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'definir_categoria' THEN
        UPDATE products SET category_id = (_params->>'categoria_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'adicionar_colecao' THEN
        UPDATE products SET collection_id = (_params->>'colecao_id')::uuid, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_colecao' THEN
        UPDATE products SET collection_id = NULL, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'destacar' THEN
        UPDATE products SET is_featured = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_destaque' THEN
        UPDATE products SET is_featured = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'lancamento' THEN
        UPDATE products SET is_new_arrival = true, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'remover_lancamento' THEN
        UPDATE products SET is_new_arrival = false, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'programar' THEN
        UPDATE products SET scheduled_publish_at = (_params->>'quando')::timestamptz, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'cancelar_agendamento' THEN
        UPDATE products SET scheduled_publish_at = NULL, updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      WHEN 'estoque_visibilidade' THEN
        UPDATE products SET stock_visibility = (_params->>'estrategia'), updated_at = now() WHERE id = ANY(_alvos);
        GET DIAGNOSTICS _afetados = ROW_COUNT;
      ELSE RAISE EXCEPTION 'acao desconhecida: %', _action;
    END CASE;
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
$function$;

-- ---------- R0.2: leitura sensível registrada de verdade ----------

DROP FUNCTION IF EXISTS public.get_party_full(uuid);
CREATE FUNCTION public.get_party_full(_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE ver_doc boolean; ver_fin boolean; p public.parties; resultado jsonb;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'registry.view') THEN
    RAISE EXCEPTION 'Sem permissão para consultar cadastros.';
  END IF;
  ver_doc := public.has_capability(auth.uid(), 'registry.doc.view');
  ver_fin := public.has_capability(auth.uid(), 'registry.finance.view');

  SELECT * INTO p FROM public.parties WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;

  resultado := jsonb_build_object(
    'party', jsonb_build_object(
      'id', p.id, 'kind', p.kind, 'code', p.code, 'display_name', p.display_name,
      'legal_name', p.legal_name, 'social_name', p.social_name,
      'doc', CASE WHEN ver_doc THEN p.doc ELSE p.doc_masked END,
      'doc_digits', CASE WHEN ver_doc THEN p.doc_digits ELSE NULL END,
      'doc_masked', p.doc_masked,
      'doc_visivel', ver_doc,
      'rg', CASE WHEN ver_doc THEN p.rg ELSE NULL END,
      'rg_issuer', CASE WHEN ver_doc THEN p.rg_issuer ELSE NULL END,
      'birth_date', p.birth_date, 'profession', p.profession,
      'marital_status', p.marital_status, 'notes', p.notes,
      'status', p.status, 'is_active', p.is_active,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'contatos', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.is_primary DESC)
                          FROM public.contact_points c WHERE c.party_id = _id), '[]'::jsonb),
    'enderecos', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.party_addresses a WHERE a.party_id = _id), '[]'::jsonb),
    'papeis', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM public.party_roles r WHERE r.party_id = _id), '[]'::jsonb),
    'vinculos', coalesce((SELECT jsonb_agg(to_jsonb(v)) FROM public.party_links v WHERE v.party_id = _id), '[]'::jsonb),
    'financeiro_visivel', ver_fin,
    'consultora', (
      SELECT CASE WHEN cp.party_id IS NULL THEN NULL ELSE
        CASE WHEN ver_fin THEN to_jsonb(cp)
        ELSE to_jsonb(cp) - 'pix_key' - 'pix_key_type' - 'pix_holder' - 'pix_holder_doc'
             - 'bank_info' - 'credit_limit_cents' - 'financial_status' - 'restricted_notes' END
      END FROM public.consultant_profiles cp WHERE cp.party_id = _id)
  );

  IF ver_doc OR ver_fin THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
    VALUES (auth.uid(), 'leitura_sensivel', 'parties', _id::text,
            jsonb_build_object('documento', ver_doc, 'financeiro', ver_fin));
  END IF;

  RETURN resultado;
END $function$;

REVOKE ALL ON FUNCTION public.get_party_full(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_party_full(uuid) TO authenticated;

-- ---------- R0.2: duplicidades sem vazar documento ----------

CREATE OR REPLACE FUNCTION public.registry_duplicates(_limit integer DEFAULT 50)
RETURNS TABLE(motivo text, chave text, quantidade bigint, ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT 'documento',
         CASE WHEN public.has_capability(auth.uid(),'registry.doc.view')
              THEN p.doc_digits ELSE public.mask_doc(p.doc_digits) END,
         count(*), array_agg(p.id ORDER BY p.created_at)
  FROM public.parties p
  WHERE public.has_capability(auth.uid(), 'registry.view') AND p.doc_digits IS NOT NULL
  GROUP BY p.doc_digits HAVING count(*) > 1
  UNION ALL
  SELECT 'contato', c.value_norm, count(DISTINCT c.party_id), array_agg(DISTINCT c.party_id)
  FROM public.contact_points c
  WHERE public.has_capability(auth.uid(), 'registry.view') AND c.value_norm IS NOT NULL
  GROUP BY c.value_norm HAVING count(DISTINCT c.party_id) > 1
  LIMIT least(greatest(COALESCE(_limit, 50), 1), 200);
$function$;
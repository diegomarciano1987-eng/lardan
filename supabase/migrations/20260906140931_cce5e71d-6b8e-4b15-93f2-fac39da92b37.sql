-- segurança das funções auxiliares
ALTER FUNCTION public.parse_decimal_any(text) SET search_path = public;
ALTER FUNCTION public.parse_cents_any(text) SET search_path = public;
ALTER FUNCTION public.norm_code(text) SET search_path = public;
REVOKE ALL ON FUNCTION public.import_job_open(text,text,text,jsonb,jsonb,uuid,date,text,text,uuid,boolean,integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.import_rows_stage(uuid,jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.import_job_validate(uuid,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_open(text,text,text,jsonb,jsonb,uuid,date,text,text,uuid,boolean,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_rows_stage(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_job_validate(uuid,integer) TO authenticated;

-- ---------- Processamento em lotes ----------
CREATE OR REPLACE FUNCTION public.import_job_process(_job uuid, _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; r record; p jsonb;
        v_id uuid; prod_id uuid; cat_id uuid; col_id uuid; forn_id uuid;
        placeholder uuid; qtd int; mov uuid;
        pc int := 0; pu int := 0; vc int := 0; vu int := 0; se int := 0; ui int := 0;
        feitas int := 0; erradas int := 0; nome text; base_slug text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.status = 'cancelado' THEN RAISE EXCEPTION 'Lote cancelado.'; END IF;

  UPDATE public.import_jobs
     SET status='processando', started_at = coalesce(started_at, now())
   WHERE id = _job;

  FOR r IN SELECT * FROM public.import_rows
            WHERE job_id = _job AND status IN ('valido','aviso')
            ORDER BY line_no LIMIT greatest(coalesce(_limit,200),1)
  LOOP
    BEGIN
      p := r.parsed; nome := p->>'nome'; qtd := coalesce((p->>'quantidade')::int,0);
      v_id := nullif(p->>'variant_id','')::uuid; prod_id := NULL; mov := NULL;

      IF j.dry_run THEN
        UPDATE public.import_rows
           SET status='processado', processed_at=now(),
               messages = messages || jsonb_build_array(jsonb_build_object('aviso','Simulação: nada foi gravado.'))
         WHERE id = r.id;
        feitas := feitas + 1;
        CONTINUE;
      END IF;

      -- categoria / coleção / fornecedor (por nome, criados como rascunho)
      cat_id := NULL; col_id := NULL; forn_id := NULL;
      IF p->>'categoria' IS NOT NULL THEN
        SELECT id INTO cat_id FROM public.categories WHERE lower(name) = lower(p->>'categoria') LIMIT 1;
        IF cat_id IS NULL THEN
          INSERT INTO public.categories (name, slug, status)
          VALUES (p->>'categoria',
                  lower(regexp_replace(p->>'categoria','[^a-zA-Z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                  'rascunho')
          RETURNING id INTO cat_id;
        END IF;
      END IF;
      IF p->>'colecao' IS NOT NULL THEN
        SELECT id INTO col_id FROM public.collections WHERE lower(name) = lower(p->>'colecao') LIMIT 1;
        IF col_id IS NULL THEN
          INSERT INTO public.collections (name, slug, status)
          VALUES (p->>'colecao',
                  lower(regexp_replace(p->>'colecao','[^a-zA-Z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                  'rascunho')
          RETURNING id INTO col_id;
        END IF;
      END IF;
      IF p->>'fornecedor' IS NOT NULL THEN
        SELECT id INTO forn_id FROM public.suppliers WHERE lower(name) = lower(p->>'fornecedor') LIMIT 1;
        IF forn_id IS NULL THEN
          INSERT INTO public.suppliers (name) VALUES (p->>'fornecedor') RETURNING id INTO forn_id;
        END IF;
      END IF;

      IF v_id IS NOT NULL THEN
        SELECT product_id INTO prod_id FROM public.product_variants WHERE id = v_id;
        UPDATE public.product_variants SET
          sku = coalesce(p->>'sku', sku),
          barcode = coalesce(p->>'ean', barcode),
          legacy_code = coalesce(p->>'codigo_legado', legacy_code),
          size = coalesce(p->>'tamanho', size),
          color = coalesce(p->>'cor', color),
          price_cents = coalesce((p->>'preco_cents')::int, price_cents),
          updated_at = now()
        WHERE id = v_id;
        vu := vu + 1;
        UPDATE public.products SET
          short_description = coalesce(p->>'descricao_curta', short_description),
          description = coalesce(p->>'descricao', description),
          material = coalesce(p->>'material', material),
          plating = coalesce(p->>'banho', plating),
          measurements = coalesce(p->>'medidas', measurements),
          weight_grams = coalesce((p->>'peso')::numeric, weight_grams),
          category_id = coalesce(cat_id, category_id),
          collection_id = coalesce(col_id, collection_id),
          supplier_id = coalesce(forn_id, supplier_id),
          price_cents = coalesce((p->>'preco_cents')::int, price_cents),
          updated_at = now()
        WHERE id = prod_id;
        pu := pu + 1;
      ELSE
        -- produto por código legado; nunca só pelo nome
        IF p->>'codigo_legado' IS NOT NULL THEN
          SELECT id INTO prod_id FROM public.products
           WHERE legacy_code IS NOT NULL AND lower(legacy_code) = lower(p->>'codigo_legado') LIMIT 1;
        END IF;
        IF prod_id IS NULL THEN
          base_slug := lower(regexp_replace(nome,'[^a-zA-Z0-9]+','-','g'));
          INSERT INTO public.products (
            name, slug, legacy_code, category_id, collection_id, supplier_id,
            short_description, description, material, plating, measurements,
            weight_grams, price_cents, price_is_public, is_featured, status
          ) VALUES (
            nome, base_slug||'-'||substr(gen_random_uuid()::text,1,6), p->>'codigo_legado',
            cat_id, col_id, forn_id, p->>'descricao_curta', p->>'descricao',
            p->>'material', p->>'banho', p->>'medidas', (p->>'peso')::numeric,
            (p->>'preco_cents')::int, coalesce((p->>'mostrar_preco')::boolean,true),
            coalesce((p->>'destaque')::boolean,false),
            CASE WHEN coalesce((p->>'publicar')::boolean,false) THEN 'publicado' ELSE 'rascunho' END::content_status
          ) RETURNING id INTO prod_id;
          pc := pc + 1;
        ELSE
          pu := pu + 1;
        END IF;

        -- aproveita a variante padrão vazia criada pelo gatilho
        SELECT pv.id INTO placeholder FROM public.product_variants pv
         WHERE pv.product_id = prod_id AND pv.is_default
           AND pv.sku IS NULL AND pv.barcode IS NULL AND pv.legacy_code IS NULL
           AND pv.price_cents IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.variant_id = pv.id)
         LIMIT 1;

        IF placeholder IS NOT NULL THEN
          UPDATE public.product_variants SET
            label = coalesce(nullif(trim(coalesce(p->>'tamanho','')||' '||coalesce(p->>'cor','')),''),'Único'),
            sku = p->>'sku', barcode = p->>'ean', legacy_code = p->>'codigo_legado',
            size = p->>'tamanho', color = p->>'cor',
            price_cents = (p->>'preco_cents')::int, updated_at = now()
          WHERE id = placeholder;
          v_id := placeholder; vu := vu + 1;
        ELSE
          INSERT INTO public.product_variants (
            product_id, label, sku, barcode, legacy_code, size, color, price_cents, position, is_active
          ) VALUES (
            prod_id,
            coalesce(nullif(trim(coalesce(p->>'tamanho','')||' '||coalesce(p->>'cor','')),''),'Único'),
            p->>'sku', p->>'ean', p->>'codigo_legado', p->>'tamanho', p->>'cor',
            (p->>'preco_cents')::int,
            (SELECT coalesce(max(position),0)+1 FROM public.product_variants WHERE product_id = prod_id),
            true
          ) RETURNING id INTO v_id;
          vc := vc + 1;
        END IF;
      END IF;

      -- custo
      IF (p->>'custo_cents') IS NOT NULL THEN
        INSERT INTO public.variant_costs (variant_id, supplier_id, cost_cents, note)
        VALUES (v_id, forn_id, (p->>'custo_cents')::int, 'Importação '||j.job_key);
      END IF;

      -- entrada de estoque idempotente
      IF j.mode = 'entrada' AND qtd > 0 THEN
        mov := public.register_stock_movement(
          'entrada'::stock_move_kind, v_id, qtd, NULL, j.location_id,
          j.reason_code, (p->>'custo_cents')::int,
          coalesce(j.reference, j.job_key), 'Importação em massa '||j.job_key,
          j.job_key||':'||r.line_no||':entrada');
        se := se + 1; ui := ui + qtd;
      END IF;

      UPDATE public.import_rows
         SET status='processado', processed_at=now(), product_id=prod_id,
             variant_id=v_id, movement_id=mov, attempts = attempts + 1
       WHERE id = r.id;
      feitas := feitas + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.import_rows
         SET status='erro', attempts = attempts + 1,
             messages = messages || jsonb_build_array(jsonb_build_object('erro', SQLERRM))
       WHERE id = r.id;
      erradas := erradas + 1;
    END;
  END LOOP;

  UPDATE public.import_jobs SET
      processed_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='processado'),
      ok_rows        = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='processado'),
      warn_rows      = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows     = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('erro','conflito')),
      products_created = products_created + pc,
      products_updated = products_updated + pu,
      variants_created = variants_created + vc,
      variants_updated = variants_updated + vu,
      stock_entries = stock_entries + se,
      units_in = units_in + ui,
      status = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows
                                  WHERE job_id=_job AND status IN ('valido','aviso','pendente'))
                    THEN 'processando' ELSE 'concluido' END,
      finished_at = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows
                                       WHERE job_id=_job AND status IN ('valido','aviso','pendente'))
                    THEN NULL ELSE now() END
   WHERE id = _job;

  RETURN jsonb_build_object(
    'processadas', feitas, 'erros_no_lote', erradas,
    'restantes', (SELECT count(*) FROM public.import_rows
                   WHERE job_id=_job AND status IN ('valido','aviso','pendente')),
    'produtos_criados', pc, 'produtos_atualizados', pu,
    'variantes_criadas', vc, 'variantes_atualizadas', vu,
    'entradas', se, 'unidades', ui);
END $$;

CREATE OR REPLACE FUNCTION public.import_job_cancel(_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.';
  END IF;
  UPDATE public.import_rows SET status='ignorado'
   WHERE job_id=_job AND status IN ('pendente','valido','aviso');
  UPDATE public.import_jobs SET status='cancelado', finished_at=now() WHERE id=_job;
END $$;

REVOKE ALL ON FUNCTION public.import_job_process(uuid,integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.import_job_cancel(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_process(uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_job_cancel(uuid) TO authenticated;

-- ---------- Vitrine: esconder variante padrão vazia ----------
CREATE OR REPLACE FUNCTION public.public_product(_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.products; res jsonb; n int;
BEGIN
  SELECT * INTO p FROM public.products
   WHERE slug = _slug AND status = 'publicado'
     AND (published_at IS NULL OR published_at <= now());
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*) INTO n FROM public.product_variants v
   WHERE v.product_id = p.id AND v.is_active;

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
                  WHERE v.product_id = p.id AND v.is_active
                    AND NOT (n > 1 AND v.is_default AND v.sku IS NULL
                             AND v.barcode IS NULL AND v.price_cents IS NULL)), '[]'::jsonb));
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.public_product(text) FROM public;
GRANT EXECUTE ON FUNCTION public.public_product(text) TO anon, authenticated;
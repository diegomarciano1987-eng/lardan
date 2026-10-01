CREATE OR REPLACE FUNCTION public.barcode_resolver(_code text, _criar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bruto text := upper(btrim(coalesce(_code,'')));
  sem_u text; unidade boolean := false; base text; tam text;
  v public.product_variants; p public.products; cat text; criada boolean := false; forma text := 'exato';
  anel_cat uuid;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'catalog.view') AND NOT public.has_capability(auth.uid(), 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para consultar peças.' USING errcode = '42501';
  END IF;
  IF bruto = '' THEN RETURN jsonb_build_object('encontrado', false, 'motivo', 'Código vazio'); END IF;
  sem_u := bruto;
  IF bruto ~ '[0-9]U$' THEN sem_u := left(bruto, length(bruto) - 1); unidade := true; END IF;

  SELECT pv.* INTO v FROM public.product_variants pv
   WHERE pv.is_active AND upper(pv.barcode) IN (bruto, sem_u)
   ORDER BY (upper(pv.barcode) = bruto) DESC, pv.is_default DESC LIMIT 1;
  IF v.id IS NOT NULL THEN
    forma := CASE WHEN upper(v.barcode) = bruto THEN 'exato' ELSE 'unidade' END;
  ELSE
    SELECT pv.* INTO v FROM public.product_variants pv JOIN public.products pp ON pp.id = pv.product_id
     WHERE pv.is_active AND (upper(pv.sku) IN (bruto, sem_u) OR upper(pv.reference_code) IN (bruto, sem_u)
        OR upper(pp.internal_code) IN (bruto, sem_u) OR upper(pp.barcode) IN (bruto, sem_u))
     ORDER BY pv.is_default DESC LIMIT 1;
    IF v.id IS NOT NULL THEN forma := 'referencia'; END IF;
  END IF;

  IF v.id IS NULL AND sem_u ~ '^[0-9]{3,}$' THEN
    base := left(sem_u, length(sem_u) - 2); tam := right(sem_u, 2);
    SELECT id INTO anel_cat FROM public.categories WHERE parent_id IS NULL AND name ILIKE 'an%is' LIMIT 1;
    SELECT pp.* INTO p FROM public.product_variants pv JOIN public.products pp ON pp.id = pv.product_id
     WHERE pv.is_active AND pv.barcode = base
       AND (public.categoria_por_nome(pp.name) = 'aneis' OR pp.category_id = anel_cat OR pp.subcategory_id = anel_cat)
     ORDER BY pv.is_default DESC LIMIT 1;
    IF p.id IS NOT NULL THEN
      forma := 'anel_tamanho';
      SELECT pv.* INTO v FROM public.product_variants pv
       WHERE pv.product_id = p.id AND pv.is_active AND (pv.barcode = sem_u OR (pv.size = tam AND pv.barcode IS DISTINCT FROM base))
       ORDER BY (pv.barcode = sem_u) DESC LIMIT 1;
      IF v.id IS NULL THEN
        IF NOT _criar THEN
          RETURN jsonb_build_object('encontrado', true, 'precisa_criar', true, 'product_id', p.id, 'produto', p.name,
            'tamanho', tam, 'codigo_base', base, 'unidade', unidade, 'forma', forma, 'categoria_nome', public.categoria_por_nome(p.name));
        END IF;
        IF NOT public.has_capability(auth.uid(), 'stock.operate') THEN
          RAISE EXCEPTION 'Sem permissão para criar a variação de tamanho.' USING errcode = '42501';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('anel:' || p.id || ':' || tam, 0));
        SELECT pv.* INTO v FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.barcode = sem_u LIMIT 1;
        IF v.id IS NULL THEN
          INSERT INTO public.product_variants (product_id, label, size, barcode, price_cents, is_default, is_active, position,
            plating_type_id, plating_supplier_id)
          SELECT p.id, 'Aro ' || tam, tam, sem_u, d.price_cents, false, true,
            coalesce((SELECT max(position) + 1 FROM public.product_variants WHERE product_id = p.id), 1),
            d.plating_type_id, d.plating_supplier_id
          FROM public.product_variants d WHERE d.product_id = p.id AND d.barcode = base LIMIT 1
          RETURNING * INTO v;
          criada := true;
          INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
          VALUES (auth.uid(), 'variante.anel_tamanho.criada', 'product_variants', v.id::text,
            jsonb_build_object('produto', p.id, 'codigo_lido', bruto, 'codigo_base', base, 'tamanho', tam));
        END IF;
      END IF;
    END IF;
  END IF;

  IF v.id IS NULL THEN RETURN jsonb_build_object('encontrado', false, 'motivo', 'Código não cadastrado'); END IF;
  SELECT * INTO p FROM public.products WHERE id = v.product_id;
  cat := public.categoria_por_nome(p.name);
  RETURN jsonb_build_object('encontrado', true, 'product_id', p.id, 'produto', p.name, 'variant_id', v.id,
    'variante', v.label, 'tamanho', CASE WHEN forma = 'anel_tamanho' THEN tam ELSE v.size END,
    'barcode', v.barcode, 'codigo_lido', bruto, 'unidade', unidade, 'forma', forma,
    'variante_criada', criada, 'categoria_nome', cat, 'preco_cents', v.price_cents);
END $$;
REVOKE ALL ON FUNCTION public.barcode_resolver(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.barcode_resolver(text, boolean) TO authenticated;
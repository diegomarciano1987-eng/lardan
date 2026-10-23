-- 1) Listas da carteira calculadas UMA vez por consulta (antes: uma chamada por linha).
CREATE OR REPLACE FUNCTION public.colab_party_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(cp.party_id), '{}') FROM consultant_profiles cp
   WHERE cp.representative_party_id = public.colab_rep() $$;
CREATE OR REPLACE FUNCTION public.colab_rem_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(r.id), '{}') FROM remessas r
   WHERE r.representante_party_id = public.colab_rep() $$;
CREATE OR REPLACE FUNCTION public.colab_cycle_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(c.id), '{}') FROM kit_cycles c
   WHERE c.representante_party_id = public.colab_rep()
      OR EXISTS (SELECT 1 FROM remessas r WHERE r.id = c.remessa_id AND r.representante_party_id = public.colab_rep()) $$;
CREATE OR REPLACE FUNCTION public.colab_praca_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(array_agg(DISTINCT lp.praca_id) FILTER (WHERE lp.praca_id IS NOT NULL), '{}')
    FROM legado_pracas lp JOIN legado_representantes lr ON lp.codigo = ANY(lr.pracas)
   WHERE lr.party_id = public.colab_rep() $$;
REVOKE ALL ON FUNCTION public.colab_party_ids(), public.colab_rem_ids(), public.colab_cycle_ids(), public.colab_praca_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colab_party_ids(), public.colab_rem_ids(), public.colab_cycle_ids(), public.colab_praca_ids() TO authenticated, service_role;

-- Mesmas regras de carteira, mesma semântica; só deixam de rodar linha a linha.
ALTER POLICY colab_carteira_guard ON public.parties
  USING ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_party_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_party_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.consultant_profiles
  USING ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.party_roles
  USING ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.contact_points
  USING ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.party_addresses
  USING ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR party_id = ANY((SELECT public.colab_party_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.remessas
  USING ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_rem_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_rem_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.kit_cycles
  USING ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_cycle_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_cycle_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.cob_pracas
  USING ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_praca_ids())::uuid[]))
  WITH CHECK ((SELECT NOT public.colab_restrita()) OR id = ANY((SELECT public.colab_praca_ids())::uuid[]));
ALTER POLICY colab_carteira_guard ON public.party_links USING ((SELECT NOT public.colab_restrita())) WITH CHECK ((SELECT NOT public.colab_restrita()));
ALTER POLICY colab_carteira_guard ON public.suppliers USING ((SELECT NOT public.colab_restrita())) WITH CHECK ((SELECT NOT public.colab_restrita()));
ALTER POLICY colab_carteira_guard ON public.business_entities USING ((SELECT NOT public.colab_restrita())) WITH CHECK ((SELECT NOT public.colab_restrita()));
ALTER POLICY colab_carteira_guard ON public.locations USING ((SELECT NOT public.colab_restrita())) WITH CHECK ((SELECT NOT public.colab_restrita()));

-- 2) Permissão de perfil avaliada uma vez por consulta em todas as políticas (mesmo texto de permissão).
DO $do$
DECLARE r record; q text; w text; sql text;
BEGIN
  FOR r IN
    SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) AS q, pg_get_expr(p.polwithcheck, p.polrelid) AS w
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
  LOOP
    q := r.q; w := r.w;
    IF q IS NOT NULL THEN
      q := regexp_replace(q, '\( SELECT has_capability\(auth\.uid\(\), (''[^'']+''::text)\) AS has_capability\)', '##HC\1##', 'g');
      q := regexp_replace(q, 'has_capability\(auth\.uid\(\), (''[^'']+''::text)\)', '(SELECT public.has_capability(auth.uid(), \1))', 'g');
      q := regexp_replace(q, '##HC(''[^'']+''::text)##', '(SELECT public.has_capability(auth.uid(), \1))', 'g');
    END IF;
    IF w IS NOT NULL THEN
      w := regexp_replace(w, '\( SELECT has_capability\(auth\.uid\(\), (''[^'']+''::text)\) AS has_capability\)', '##HC\1##', 'g');
      w := regexp_replace(w, 'has_capability\(auth\.uid\(\), (''[^'']+''::text)\)', '(SELECT public.has_capability(auth.uid(), \1))', 'g');
      w := regexp_replace(w, '##HC(''[^'']+''::text)##', '(SELECT public.has_capability(auth.uid(), \1))', 'g');
    END IF;
    IF q IS DISTINCT FROM r.q OR w IS DISTINCT FROM r.w THEN
      sql := format('ALTER POLICY %I ON public.%I', r.polname, r.relname);
      IF q IS NOT NULL THEN sql := sql || ' USING (' || q || ')'; END IF;
      IF w IS NOT NULL THEN sql := sql || ' WITH CHECK (' || w || ')'; END IF;
      EXECUTE sql;
    END IF;
  END LOOP;
END $do$;

-- 3) Anel com tamanho: quem monta maleta (kit.manage / kit.acrescimo) também pode
--    registrar a variação do aro lido, como o Estoque já fazia. Resto idêntico.
CREATE OR REPLACE FUNCTION public.barcode_resolver(_code text, _criar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        IF NOT (public.has_capability(auth.uid(), 'stock.operate')
             OR public.has_capability(auth.uid(), 'kit.manage')
             OR public.has_capability(auth.uid(), 'kit.acrescimo')) THEN
          RAISE EXCEPTION 'Sem permissão para registrar o tamanho do anel.' USING errcode = '42501';
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
END $function$;
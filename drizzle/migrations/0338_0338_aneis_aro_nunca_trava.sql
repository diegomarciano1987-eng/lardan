-- 0338 (Diego/Daniel, 19/11/2026) — anéis do aro 4 ao 30 nunca travam.
-- 1) tamanho normalizado (4 → '04'); 2) anel identificado pela categoria ou pelo nome;
-- 3) código de aro reservado: o sequencial de 5 dígitos nunca usa base de anel + 2 dígitos;
-- 4) um único motor cria o aro (barras base+aro; se o número já for de outra peça, ganha código próprio);
-- 5) leitor aceita aro com 2 dígitos (1846104) e com 1 dígito (184614); base lida na montagem pede o aro;
-- 6) grade de aros por produto (ex.: 4 ao 30) para imprimir etiquetas antes da montagem.
-- Nada mexe em estoque, preço, maleta ou financeiro; travas de código único continuam valendo.

CREATE OR REPLACE FUNCTION public.anel_tamanho_norm(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE WHEN btrim(coalesce(_t,'')) ~ '^\d{1,2}$' AND btrim(_t)::int BETWEEN 1 AND 99
              THEN lpad(btrim(_t)::int::text, 2, '0') END
$$;
GRANT EXECUTE ON FUNCTION public.anel_tamanho_norm(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anel_eh_produto(_p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products pp
     WHERE pp.id = _p
       AND (public.categoria_por_nome(pp.name) = 'aneis'
            OR EXISTS (SELECT 1 FROM public.categories c
                        WHERE c.id IN (pp.category_id, pp.subcategory_id) AND c.parent_id IS NULL AND c.name ILIKE 'an%is')))
$$;
REVOKE ALL ON FUNCTION public.anel_eh_produto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anel_eh_produto(uuid) TO authenticated, service_role;

-- Anel ajustável não tem aro: entra direto, como sempre entrou.
CREATE OR REPLACE FUNCTION public.anel_ajustavel(_nome text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT upper(coalesce(_nome,'')) ~ 'AJUST|ABERTO'
$$;
GRANT EXECUTE ON FUNCTION public.anel_ajustavel(text) TO authenticated, service_role;

-- Base de anel + 2 dígitos: número reservado ao aro daquele anel.
CREATE OR REPLACE FUNCTION public.anel_codigo_reservado(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(_code,'') ~ '^\d{3,}$' AND EXISTS (
    SELECT 1 FROM public.product_variants pv
     WHERE pv.barcode = left(_code, length(_code) - 2) AND pv.size IS NULL
       AND public.anel_eh_produto(pv.product_id))
$$;
REVOKE ALL ON FUNCTION public.anel_codigo_reservado(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anel_codigo_reservado(text) TO service_role;

-- Sequencial curto: mesmo comportamento, só pula números reservados a aros de anel.
CREATE OR REPLACE FUNCTION public.variant_ean_next() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  tent int := 0;
  codigo text;
begin
  -- Código curto sequencial (padrão Lardan, 5 dígitos): legível na etiqueta Argox 95x12 mm.
  -- EAN-13 de 13 dígitos não é lido após impressão térmica nessa etiqueta.
  -- 0338: nunca entrega base de anel + 2 dígitos (seria lido como aro daquele anel).
  loop
    tent := tent + 1;
    if tent > 5000 then
      raise exception 'Não foi possível gerar um código de barras livre.' using errcode = '23505';
    end if;
    codigo := nextval('public.variant_codigo_curto_seq')::text;
    if not exists (select 1 from public.product_variants v where v.barcode = codigo)
       and not exists (select 1 from public.products p where p.barcode = codigo)
       and not public.anel_codigo_reservado(codigo) then
      return codigo;
    end if;
  end loop;
end
$$;
REVOKE ALL ON FUNCTION public.variant_ean_next() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.variant_ean_next() TO service_role;

-- Motor único do aro (interno). Acha a variação do aro; se faltar e _criar, cria com barras base+aro
-- (ou código próprio quando o número já é de outra peça), herdando preço/banho/NCM da variação base.
CREATE OR REPLACE FUNCTION public.anel_aro_garantir(_p uuid, _tam text, _lido text, _criar boolean, _origem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tam text := public.anel_tamanho_norm(_tam);
  v public.product_variants; d public.product_variants;
  canon text; cod text; proprio boolean := false; reativada boolean := false;
BEGIN
  IF tam IS NULL THEN RAISE EXCEPTION 'Aro inválido: %. Use um número de 1 a 99.', coalesce(_tam,'vazio') USING errcode = '22023'; END IF;
  IF NOT public.anel_eh_produto(_p) THEN RAISE EXCEPTION 'Esta peça não é anel.' USING errcode = '22023'; END IF;
  SELECT * INTO d FROM public.product_variants
   WHERE product_id = _p AND is_active AND size IS NULL AND barcode ~ '^\d+$'
   ORDER BY is_default DESC, position, created_at LIMIT 1;
  canon := CASE WHEN d.barcode IS NOT NULL THEN d.barcode || tam END;

  SELECT pv.* INTO v FROM public.product_variants pv
   WHERE pv.product_id = _p AND pv.is_active
     AND (pv.barcode = canon OR public.anel_tamanho_norm(pv.size) = tam OR upper(btrim(pv.label)) = 'ARO ' || tam)
     AND pv.barcode IS DISTINCT FROM d.barcode
   ORDER BY coalesce(pv.barcode = canon, false) DESC, pv.position LIMIT 1;
  IF v.id IS NOT NULL THEN
    RETURN jsonb_build_object('variant_id', v.id, 'criada', false, 'tamanho', tam, 'barcode', v.barcode, 'codigo_proprio', false);
  END IF;
  IF NOT _criar THEN
    RETURN jsonb_build_object('precisa_criar', true, 'tamanho', tam, 'codigo', canon);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('anel:' || _p || ':' || tam, 0));
  -- de novo, já com a trava (e incluindo variação desligada do mesmo aro, que só volta a valer)
  SELECT pv.* INTO v FROM public.product_variants pv
   WHERE pv.product_id = _p
     AND (pv.barcode = canon OR public.anel_tamanho_norm(pv.size) = tam OR upper(btrim(pv.label)) = 'ARO ' || tam)
     AND pv.barcode IS DISTINCT FROM d.barcode
   ORDER BY pv.is_active DESC, coalesce(pv.barcode = canon, false) DESC LIMIT 1;
  IF v.id IS NOT NULL THEN
    IF NOT v.is_active THEN
      UPDATE public.product_variants SET is_active = true, size = coalesce(size, tam) WHERE id = v.id RETURNING * INTO v;
      reativada := true;
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
      VALUES (auth.uid(), 'variante.anel_tamanho.reativada', 'product_variants', v.id::text,
        jsonb_build_object('produto', _p, 'codigo_lido', _lido, 'tamanho', tam, 'origem', _origem));
    END IF;
    RETURN jsonb_build_object('variant_id', v.id, 'criada', false, 'reativada', reativada, 'tamanho', tam, 'barcode', v.barcode, 'codigo_proprio', false);
  END IF;

  cod := canon;
  IF cod IS NULL
     OR EXISTS (SELECT 1 FROM public.product_variants x WHERE x.barcode = cod)
     OR EXISTS (SELECT 1 FROM public.products x WHERE x.barcode = cod AND x.id <> _p) THEN
    cod := public.variant_ean_next();
    proprio := true;
  END IF;

  INSERT INTO public.product_variants (product_id, label, size, barcode, price_cents, is_default, is_active, position,
    plating_type_id, plating_supplier_id, ncm)
  VALUES (_p, 'Aro ' || tam, tam, cod,
    coalesce(d.price_cents, (SELECT price_cents FROM public.products WHERE id = _p)), false, true, 1000 + tam::int,
    d.plating_type_id, d.plating_supplier_id, d.ncm)
  RETURNING * INTO v;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'variante.anel_tamanho.criada', 'product_variants', v.id::text,
    jsonb_build_object('produto', _p, 'codigo_lido', _lido, 'codigo_base', d.barcode, 'tamanho', tam,
      'barcode', cod, 'codigo_proprio', proprio, 'origem', _origem));
  RETURN jsonb_build_object('variant_id', v.id, 'criada', true, 'tamanho', tam, 'barcode', cod, 'codigo_proprio', proprio);
END $$;
REVOKE ALL ON FUNCTION public.anel_aro_garantir(uuid, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anel_aro_garantir(uuid, text, text, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.anel_pode_registrar_aro() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_capability(auth.uid(), 'stock.operate') OR public.has_capability(auth.uid(), 'kit.manage')
      OR public.has_capability(auth.uid(), 'kit.acrescimo') OR public.has_capability(auth.uid(), 'product.manage')
$$;
REVOKE ALL ON FUNCTION public.anel_pode_registrar_aro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anel_pode_registrar_aro() TO authenticated, service_role;

-- Leitor: mesma resposta de antes + aro de 1 dígito, aro com código próprio e (no modo interativo da montagem)
-- 'pede_aro' quando a base de um anel é lida e 'ambiguo' quando o código cabe em dois anéis.
DROP FUNCTION IF EXISTS public.barcode_resolver(text, boolean);
CREATE OR REPLACE FUNCTION public.barcode_resolver(_code text, _criar boolean DEFAULT false, _interativo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  bruto text := upper(btrim(coalesce(_code,'')));
  sem_u text; unidade boolean := false;
  v public.product_variants; p public.products; cat text; criada boolean := false; proprio boolean := false;
  forma text := 'exato';
  p2 uuid; b2 text; t2 text; p1 uuid; b1 text; t1 text;
  alvo uuid; tam text; base text; r jsonb;
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
        OR upper(pp.internal_code) IN (bruto, sem_u) OR upper(pp.barcode) IN (bruto, sem_u)
        OR upper(pp.reference_code) IN (bruto, sem_u))
     ORDER BY pv.is_default DESC, pv.position LIMIT 1;
    IF v.id IS NOT NULL THEN forma := 'referencia'; END IF;
  END IF;

  IF v.id IS NOT NULL THEN
    -- Base de anel lida (ou referência digitada) sem aro: na montagem, pergunta o aro em vez de entrar sem tamanho.
    IF _interativo AND v.size IS NULL AND public.anel_eh_produto(v.product_id) THEN
      SELECT * INTO p FROM public.products WHERE id = v.product_id;
      IF NOT public.anel_ajustavel(p.name) AND NOT public.anel_ajustavel(v.label) THEN
        RETURN jsonb_build_object('encontrado', true, 'pede_aro', true, 'product_id', p.id, 'produto', p.name,
          'variant_id_base', v.id, 'variante', v.label, 'codigo_base', v.barcode, 'codigo_lido', bruto, 'forma', forma,
          'preco_cents', v.price_cents, 'categoria_nome', public.categoria_por_nome(p.name),
          'aros_existentes', coalesce((SELECT jsonb_agg(public.anel_tamanho_norm(x.size) ORDER BY public.anel_tamanho_norm(x.size))
                                         FROM public.product_variants x
                                        WHERE x.product_id = p.id AND x.is_active AND public.anel_tamanho_norm(x.size) IS NOT NULL), '[]'::jsonb));
      END IF;
    END IF;
  ELSIF sem_u ~ '^[0-9]{3,}$' THEN
    -- Anel com aro no fim do código: base + 2 dígitos (1846104) ou base + 1 dígito (184614).
    b2 := left(sem_u, length(sem_u) - 2); t2 := public.anel_tamanho_norm(right(sem_u, 2));
    IF t2 IS NOT NULL THEN
      SELECT pv.product_id INTO p2 FROM public.product_variants pv
       WHERE pv.is_active AND pv.barcode = b2 AND public.anel_eh_produto(pv.product_id)
       ORDER BY pv.is_default DESC LIMIT 1;
    END IF;
    b1 := left(sem_u, length(sem_u) - 1); t1 := public.anel_tamanho_norm(right(sem_u, 1));
    IF t1 IS NOT NULL THEN
      SELECT pv.product_id INTO p1 FROM public.product_variants pv
       WHERE pv.is_active AND pv.barcode = b1 AND public.anel_eh_produto(pv.product_id)
       ORDER BY pv.is_default DESC LIMIT 1;
    END IF;
    IF p2 IS NOT NULL AND p1 IS NOT NULL AND _interativo THEN
      RETURN jsonb_build_object('encontrado', true, 'ambiguo', true, 'codigo_lido', bruto, 'opcoes', jsonb_build_array(
        jsonb_build_object('product_id', p2, 'produto', (SELECT name FROM public.products WHERE id = p2), 'tamanho', t2, 'codigo_base', b2),
        jsonb_build_object('product_id', p1, 'produto', (SELECT name FROM public.products WHERE id = p1), 'tamanho', t1, 'codigo_base', b1)));
    END IF;
    IF p2 IS NOT NULL THEN alvo := p2; tam := t2; base := b2;
    ELSIF p1 IS NOT NULL THEN alvo := p1; tam := t1; base := b1; END IF;

    IF alvo IS NOT NULL THEN
      forma := 'anel_tamanho';
      r := public.anel_aro_garantir(alvo, tam, bruto, false, 'leitor');
      IF coalesce((r->>'precisa_criar')::boolean, false) THEN
        IF NOT _criar THEN
          SELECT * INTO p FROM public.products WHERE id = alvo;
          RETURN jsonb_build_object('encontrado', true, 'precisa_criar', true, 'product_id', p.id, 'produto', p.name,
            'tamanho', tam, 'codigo_base', base, 'unidade', unidade, 'forma', forma, 'categoria_nome', public.categoria_por_nome(p.name));
        END IF;
        IF NOT public.anel_pode_registrar_aro() THEN
          RAISE EXCEPTION 'Sem permissão para registrar o tamanho do anel.' USING errcode = '42501';
        END IF;
        r := public.anel_aro_garantir(alvo, tam, bruto, true, 'leitor');
      END IF;
      criada := coalesce((r->>'criada')::boolean, false);
      proprio := coalesce((r->>'codigo_proprio')::boolean, false);
      SELECT * INTO v FROM public.product_variants WHERE id = (r->>'variant_id')::uuid;
    END IF;
  END IF;

  IF v.id IS NULL THEN RETURN jsonb_build_object('encontrado', false, 'motivo', 'Código não cadastrado'); END IF;
  SELECT * INTO p FROM public.products WHERE id = v.product_id;
  cat := public.categoria_por_nome(p.name);
  RETURN jsonb_build_object('encontrado', true, 'product_id', p.id, 'produto', p.name, 'variant_id', v.id,
    'variante', v.label, 'tamanho', CASE WHEN forma = 'anel_tamanho' THEN tam ELSE v.size END,
    'barcode', v.barcode, 'codigo_lido', bruto, 'unidade', unidade, 'forma', forma,
    'variante_criada', criada, 'codigo_proprio', proprio, 'categoria_nome', cat, 'preco_cents', v.price_cents);
END $function$;
REVOKE ALL ON FUNCTION public.barcode_resolver(text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.barcode_resolver(text, boolean, boolean) TO authenticated, service_role;

-- Aro escolhido na tela (anel lido pela base ou buscado pelo nome/referência): mesma resposta do leitor.
CREATE OR REPLACE FUNCTION public.anel_aro_variante(_product uuid, _tamanho text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; v public.product_variants; p public.products;
BEGIN
  IF NOT public.has_capability(auth.uid(), 'catalog.view') AND NOT public.has_capability(auth.uid(), 'stock.operate') THEN
    RAISE EXCEPTION 'Sem permissão para consultar peças.' USING errcode = '42501';
  END IF;
  r := public.anel_aro_garantir(_product, _tamanho, 'aro escolhido: ' || coalesce(_tamanho,''), false, 'escolha');
  IF coalesce((r->>'precisa_criar')::boolean, false) THEN
    IF NOT public.anel_pode_registrar_aro() THEN
      RAISE EXCEPTION 'Sem permissão para registrar o tamanho do anel.' USING errcode = '42501';
    END IF;
    r := public.anel_aro_garantir(_product, _tamanho, 'aro escolhido: ' || coalesce(_tamanho,''), true, 'escolha');
  END IF;
  SELECT * INTO v FROM public.product_variants WHERE id = (r->>'variant_id')::uuid;
  SELECT * INTO p FROM public.products WHERE id = v.product_id;
  RETURN jsonb_build_object('encontrado', true, 'product_id', p.id, 'produto', p.name, 'variant_id', v.id,
    'variante', v.label, 'tamanho', r->>'tamanho', 'barcode', v.barcode, 'codigo_lido', v.barcode, 'unidade', false,
    'forma', 'anel_tamanho', 'variante_criada', coalesce((r->>'criada')::boolean, false),
    'codigo_proprio', coalesce((r->>'codigo_proprio')::boolean, false),
    'categoria_nome', public.categoria_por_nome(p.name), 'preco_cents', v.price_cents);
END $$;
REVOKE ALL ON FUNCTION public.anel_aro_variante(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anel_aro_variante(uuid, text) TO authenticated, service_role;

-- Grade de aros do anel (ex.: 4 ao 30): cria só o que falta, ordena por aro e audita. Nunca mexe em estoque.
CREATE OR REPLACE FUNCTION public.anel_grade_gerar(_product uuid, _de integer, _ate integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i int; r jsonb; criadas jsonb := '[]'; existentes jsonb := '[]'; proprios jsonb := '[]'; nome text;
BEGIN
  IF NOT (public.has_capability(auth.uid(), 'product.manage') OR public.has_capability(auth.uid(), 'stock.operate')
          OR public.has_capability(auth.uid(), 'kit.manage')) THEN
    RAISE EXCEPTION 'Sem permissão para gerar a grade de aros.' USING errcode = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _de < 1 OR _ate > 60 OR _de > _ate THEN
    RAISE EXCEPTION 'Grade inválida: use aros de 1 a 60, do menor para o maior.' USING errcode = '22023';
  END IF;
  IF NOT public.anel_eh_produto(_product) THEN RAISE EXCEPTION 'Esta peça não é anel.' USING errcode = '22023'; END IF;
  SELECT name INTO nome FROM public.products WHERE id = _product;
  PERFORM pg_advisory_xact_lock(hashtextextended('anel-grade:' || _product, 0));
  FOR i IN _de.._ate LOOP
    r := public.anel_aro_garantir(_product, i::text, 'grade ' || _de || '-' || _ate, true, 'grade');
    IF coalesce((r->>'criada')::boolean, false) THEN
      criadas := criadas || to_jsonb(r->>'tamanho');
      IF coalesce((r->>'codigo_proprio')::boolean, false) THEN
        proprios := proprios || jsonb_build_object('tamanho', r->>'tamanho', 'barcode', r->>'barcode');
      END IF;
    ELSE
      existentes := existentes || to_jsonb(r->>'tamanho');
    END IF;
  END LOOP;
  -- aros na ordem do tamanho, depois das demais variações (só a ordem de exibição)
  UPDATE public.product_variants SET position = 1000 + public.anel_tamanho_norm(size)::int
   WHERE product_id = _product AND public.anel_tamanho_norm(size) IS NOT NULL
     AND position IS DISTINCT FROM 1000 + public.anel_tamanho_norm(size)::int;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), 'produto.anel_grade.gerada', 'products', _product::text,
    jsonb_build_object('de', _de, 'ate', _ate, 'criadas', criadas, 'existentes', existentes, 'codigo_proprio', proprios));
  RETURN jsonb_build_object('produto', nome, 'criadas', criadas, 'existentes', existentes, 'codigo_proprio', proprios,
    'total_criadas', jsonb_array_length(criadas), 'total_existentes', jsonb_array_length(existentes));
END $$;
REVOKE ALL ON FUNCTION public.anel_grade_gerar(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anel_grade_gerar(uuid, integer, integer) TO authenticated, service_role;
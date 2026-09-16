CREATE OR REPLACE FUNCTION public.import_job_process(_job uuid, _limit integer DEFAULT 200, _worker uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE j public.import_jobs; r record; p jsonb; w uuid := coalesce(_worker, gen_random_uuid());
        pr public.products; pv public.product_variants;
        v_id uuid; prod_id uuid; cat_id uuid; sub_id uuid; col_id uuid; forn_id uuid;
        forn_banho uuid; plat_id uuid; placeholder uuid;
        qtd int; mov uuid; ef jsonb; pubres jsonb; pubst text; msgs jsonb;
        feitas int := 0; erradas int := 0; restantes int; com_erro int; nome text; base_slug text;
        criou_cat boolean; criou_col boolean; criou_forn boolean; novo_produto boolean;
        chave text; dup boolean; e_prod text; e_var text; e_custo text; e_estoque text;
        idem text; label_novo text; pode_publicar boolean;
        conflito record; cod_barras text; sku_novo text; token text; ult record;
        c_bruto int; c_banho int; c_verniz int; c_final int; c_soma int; interno text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.responsible_user_id IS DISTINCT FROM auth.uid()
     AND NOT (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria')) THEN
    RAISE EXCEPTION 'Lote fora do seu escopo.' USING ERRCODE='42501';
  END IF;
  IF j.status IN ('concluido','concluido_com_erros') THEN
    RETURN jsonb_build_object('processadas', 0, 'restantes', 0, 'encerrado', true,
      'status', j.status, 'indicadores', public.import_job_counters(_job));
  END IF;
  IF j.status = 'cancelado' THEN
    RAISE EXCEPTION 'Lote cancelado (%).', coalesce(j.cancel_reason,'sem motivo');
  END IF;
  IF j.status IN ('pausando','pausado') THEN
    UPDATE public.import_jobs SET status='pausado', paused_at=coalesce(paused_at, now())
     WHERE id=_job AND status='pausando';
    RETURN jsonb_build_object('pausado', true, 'processadas', 0,
      'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso')),
      'indicadores', public.import_job_counters(_job));
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtextextended('lardan.import:'||_job::text, 0)) THEN
    RETURN jsonb_build_object('processadas', 0, 'ocupado', true,
      'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso')),
      'indicadores', public.import_job_counters(_job));
  END IF;

  pode_publicar := public.has_capability(auth.uid(),'showcase.publish')
                OR public.has_capability(auth.uid(),'catalog.publish');

  IF j.dry_run THEN
    UPDATE public.import_jobs SET status='simulando' WHERE id=_job AND status IN ('pronto','validando');
  ELSE
    UPDATE public.import_jobs SET status='processando', started_at=coalesce(started_at, now())
     WHERE id=_job AND status IN ('pronto','simulado','pausado','falhou');
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job;

  FOR r IN
    WITH alvo AS (
      SELECT id FROM public.import_rows
       WHERE job_id=_job
         AND (status IN ('valido','aviso')
              OR (status='processando' AND coalesce(claim_until, now()) < now()))
       ORDER BY line_no
       LIMIT greatest(coalesce(_limit,200),1)
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.import_rows ir
       SET status='processando', claimed_by=w, claim_until=now() + interval '5 minutes'
      FROM alvo WHERE ir.id = alvo.id
    RETURNING ir.*
  LOOP
    BEGIN
      p := r.parsed; nome := p->>'nome'; qtd := coalesce((p->>'quantidade')::int,0);
      v_id := nullif(p->>'variant_id','')::uuid; prod_id := NULL; mov := NULL;
      msgs := coalesce(r.messages,'[]'::jsonb); pubst := NULL;
      criou_cat := false; criou_col := false; criou_forn := false; novo_produto := false;
      e_custo := NULL; e_estoque := NULL; e_prod := NULL; e_var := NULL;
      cod_barras := nullif(p->>'ean','');
      plat_id := nullif(p->>'plating_type_id','')::uuid;
      sub_id := nullif(p->>'subcategory_id','')::uuid;
      chave := upper(coalesce(p->>'codigo_legado', p->>'sku', p->>'ean', p->>'codigo_interno', nome));

      SELECT EXISTS (SELECT 1 FROM public.import_rows x
                      WHERE x.job_id=_job AND x.id <> r.id AND x.line_no < r.line_no
                        AND x.status IN ('processado','simulado')
                        AND upper(coalesce(x.parsed->>'codigo_legado', x.parsed->>'sku',
                                           x.parsed->>'ean', x.parsed->>'codigo_interno',
                                           x.parsed->>'nome')) = chave)
        INTO dup;
      dup := dup OR public.import_row_dup_in_file(_job, r.id, r.line_no, p->>'sku', p->>'ean');

      IF dup THEN
        UPDATE public.import_rows
           SET status='conflito', error_code='duplicada_no_arquivo', attempts = attempts + 1,
               claimed_by=NULL, claim_until=NULL, processed_at=now(),
               effects = jsonb_build_object('produto','recusado','variante','recusada',
                                            'chave', chave, 'duplicada', true, 'simulado', j.dry_run),
               messages = msgs || jsonb_build_array(jsonb_build_object(
                 'campo','identificacao',
                 'erro','Esta linha repete o código de outra linha do mesmo arquivo.',
                 'correcao','Deixe apenas uma linha por peça ou variação e reenvie a corrigida.'))
         WHERE id = r.id;
        feitas := feitas + 1;
        CONTINUE;
      END IF;

      IF public.import_row_conflict(v_id, p->>'codigo_legado') THEN
        UPDATE public.import_rows
           SET status='conflito', error_code='conflito_identidade', attempts = attempts + 1,
               claimed_by=NULL, claim_until=NULL, processed_at=now(),
               effects = jsonb_build_object('produto','recusado','variante','recusada',
                                            'chave', chave, 'duplicada', false, 'simulado', j.dry_run),
               messages = msgs || jsonb_build_array(jsonb_build_object(
                 'campo','sku',
                 'erro','O SKU ou o código de barras informado já pertence a outra peça.',
                 'correcao','Corrija o SKU/código de barras ou informe o código legado da peça correta.'))
         WHERE id = r.id;
        feitas := feitas + 1;
        CONTINUE;
      END IF;

      -- código de barras já usado por OUTRA variante: recusa dizendo quem usa
      IF cod_barras IS NOT NULL THEN
        SELECT pp.name AS produto, vv.label AS variante INTO conflito
          FROM public.product_variants vv JOIN public.products pp ON pp.id = vv.product_id
         WHERE vv.barcode = cod_barras AND (v_id IS NULL OR vv.id <> v_id) LIMIT 1;
        IF FOUND THEN
          UPDATE public.import_rows
             SET status='conflito', error_code='barcode_duplicado', attempts = attempts + 1,
                 claimed_by=NULL, claim_until=NULL, processed_at=now(),
                 effects = jsonb_build_object('produto','recusado','variante','recusada',
                                              'chave', chave, 'duplicada', false, 'simulado', j.dry_run),
                 messages = msgs || jsonb_build_array(jsonb_build_object(
                   'campo','ean','valor',cod_barras,
                   'erro','O código de barras '||cod_barras||' já é usado por '||conflito.produto||' — '||coalesce(conflito.variante,'variante')||'.',
                   'correcao','Corrija o código de barras desta linha.'))
           WHERE id = r.id;
          feitas := feitas + 1;
          CONTINUE;
        END IF;
      END IF;

      -- SKU já usado por outra variante
      IF (p->>'sku') IS NOT NULL THEN
        SELECT pp.name AS produto, vv.label AS variante INTO conflito
          FROM public.product_variants vv JOIN public.products pp ON pp.id = vv.product_id
         WHERE upper(vv.sku) = upper(p->>'sku') AND (v_id IS NULL OR vv.id <> v_id) LIMIT 1;
        IF FOUND THEN
          UPDATE public.import_rows
             SET status='conflito', error_code='sku_duplicado', attempts = attempts + 1,
                 claimed_by=NULL, claim_until=NULL, processed_at=now(),
                 effects = jsonb_build_object('produto','recusado','variante','recusada',
                                              'chave', chave, 'duplicada', false, 'simulado', j.dry_run),
                 messages = msgs || jsonb_build_array(jsonb_build_object(
                   'campo','sku','valor',p->>'sku',
                   'erro','O SKU '||(p->>'sku')||' já é usado por '||conflito.produto||' — '||coalesce(conflito.variante,'variante')||'.',
                   'correcao','Corrija o SKU desta linha.'))
           WHERE id = r.id;
          feitas := feitas + 1;
          CONTINUE;
        END IF;
      END IF;

      -- categoria / subcategoria / coleção / fornecedores
      cat_id := nullif(p->>'category_id','')::uuid; col_id := NULL;
      forn_id := nullif(p->>'fornecedor_bruto_id','')::uuid;
      forn_banho := nullif(p->>'fornecedor_banho_id','')::uuid;

      IF cat_id IS NULL AND p->>'categoria' IS NOT NULL THEN
        SELECT id INTO cat_id FROM public.categories
          WHERE public.norm_name(name)=public.norm_name(p->>'categoria') LIMIT 1;
        IF cat_id IS NULL THEN
          criou_cat := true;
          IF NOT j.dry_run THEN
            INSERT INTO public.categories (name, slug, status)
            VALUES (p->>'categoria',
                    lower(regexp_replace(public.norm_name(p->>'categoria'),'[^a-z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                    'rascunho')
            ON CONFLICT (public.norm_name(name)) WHERE parent_id IS NULL DO NOTHING
            RETURNING id INTO cat_id;
            IF cat_id IS NULL THEN
              criou_cat := false;
              SELECT id INTO cat_id FROM public.categories
                WHERE public.norm_name(name)=public.norm_name(p->>'categoria') LIMIT 1;
            END IF;
          END IF;
        END IF;
      END IF;

      IF p->>'colecao' IS NOT NULL THEN
        SELECT id INTO col_id FROM public.collections
          WHERE public.norm_name(name)=public.norm_name(p->>'colecao') LIMIT 1;
        IF col_id IS NULL THEN
          criou_col := true;
          IF NOT j.dry_run THEN
            INSERT INTO public.collections (name, slug, status)
            VALUES (p->>'colecao',
                    lower(regexp_replace(public.norm_name(p->>'colecao'),'[^a-z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                    'rascunho')
            ON CONFLICT (public.norm_name(name)) DO NOTHING
            RETURNING id INTO col_id;
            IF col_id IS NULL THEN
              criou_col := false;
              SELECT id INTO col_id FROM public.collections
                WHERE public.norm_name(name)=public.norm_name(p->>'colecao') LIMIT 1;
            END IF;
          END IF;
        END IF;
      END IF;

      IF forn_id IS NULL AND p->>'fornecedor' IS NOT NULL THEN
        forn_id := public.import_supplier(p->>'fornecedor');
        IF forn_id IS NULL THEN
          criou_forn := true;
          IF NOT j.dry_run THEN
            INSERT INTO public.suppliers (name) VALUES (p->>'fornecedor')
            ON CONFLICT (public.norm_name(name)) DO NOTHING
            RETURNING id INTO forn_id;
            IF forn_id IS NULL THEN
              criou_forn := false;
              forn_id := public.import_supplier(p->>'fornecedor');
            END IF;
          END IF;
        END IF;
      END IF;
      IF forn_banho IS NULL AND p->>'fornecedor_banho' IS NOT NULL AND NOT j.dry_run THEN
        INSERT INTO public.suppliers (name) VALUES (p->>'fornecedor_banho')
        ON CONFLICT (public.norm_name(name)) DO NOTHING
        RETURNING id INTO forn_banho;
        IF forn_banho IS NULL THEN forn_banho := public.import_supplier(p->>'fornecedor_banho'); END IF;
      END IF;

      -- identidade do produto-base: código interno, depois código legado
      IF v_id IS NULL AND p->>'codigo_interno' IS NOT NULL THEN
        SELECT id INTO prod_id FROM public.products
         WHERE upper(internal_code) = upper(p->>'codigo_interno') LIMIT 1;
      END IF;
      IF v_id IS NULL AND prod_id IS NULL AND p->>'codigo_legado_produto' IS NOT NULL THEN
        SELECT id INTO prod_id FROM public.products
         WHERE upper(legacy_code) = upper(p->>'codigo_legado_produto') LIMIT 1;
      END IF;
      IF v_id IS NULL AND prod_id IS NULL AND p->>'codigo_legado' IS NOT NULL THEN
        SELECT id INTO prod_id FROM public.products
         WHERE upper(legacy_code) = upper(p->>'codigo_legado') LIMIT 1;
      END IF;

      IF v_id IS NOT NULL THEN
        SELECT * INTO pv FROM public.product_variants WHERE id = v_id;
        prod_id := pv.product_id;
        SELECT * INTO pr FROM public.products WHERE id = prod_id;

        -- nunca troca barcode/SKU já gravados em silêncio
        IF cod_barras IS NOT NULL AND pv.barcode IS NOT NULL AND pv.barcode <> cod_barras THEN
          msgs := msgs || jsonb_build_object('campo','ean','valor',cod_barras,
            'aviso','Esta peça já tem outro código de barras ('||pv.barcode||'): o código da planilha foi ignorado.');
          cod_barras := pv.barcode;
        END IF;
        IF (p->>'sku') IS NOT NULL AND pv.sku IS NOT NULL AND upper(pv.sku) <> upper(p->>'sku') THEN
          msgs := msgs || jsonb_build_object('campo','sku','valor',p->>'sku',
            'aviso','Esta peça já tem outro SKU ('||pv.sku||'): o SKU da planilha foi ignorado.');
        END IF;

        IF (pv.sku, pv.barcode, pv.legacy_code, pv.size, pv.color, pv.price_cents,
            pv.plating_type_id, pv.plating_supplier_id, pv.varnish_name, pv.final_weight_grams,
            pv.is_active) IS DISTINCT FROM
           (coalesce(pv.sku, p->>'sku'), coalesce(pv.barcode, cod_barras),
            coalesce(p->>'codigo_legado', pv.legacy_code), coalesce(p->>'tamanho', pv.size),
            coalesce(p->>'cor', pv.color), coalesce((p->>'preco_cents')::int, pv.price_cents),
            coalesce(plat_id, pv.plating_type_id), coalesce(forn_banho, pv.plating_supplier_id),
            coalesce(p->>'verniz', pv.varnish_name),
            coalesce((p->>'peso_final')::numeric, pv.final_weight_grams),
            coalesce((p->>'variante_ativa')::boolean, pv.is_active)) THEN
          e_var := 'alterada';
          IF NOT j.dry_run THEN
            UPDATE public.product_variants SET
              sku = coalesce(sku, p->>'sku'), barcode = coalesce(barcode, cod_barras),
              legacy_code = coalesce(p->>'codigo_legado', legacy_code),
              size = coalesce(p->>'tamanho', size), color = coalesce(p->>'cor', color),
              price_cents = coalesce((p->>'preco_cents')::int, price_cents),
              plating_type_id = coalesce(plat_id, plating_type_id),
              plating_supplier_id = coalesce(forn_banho, plating_supplier_id),
              varnish_name = coalesce(p->>'verniz', varnish_name),
              final_weight_grams = coalesce((p->>'peso_final')::numeric, final_weight_grams),
              is_active = coalesce((p->>'variante_ativa')::boolean, is_active),
              label = coalesce(p->>'nome_variante', label),
              updated_at = now()
            WHERE id = v_id;
          END IF;
        ELSE e_var := 'sem_alteracao'; END IF;

        IF (pr.short_description, pr.description, pr.material, pr.measurements,
            pr.weight_grams, pr.category_id, pr.subcategory_id, pr.collection_id, pr.supplier_id,
            pr.price_cents, pr.raw_material, pr.raw_weight_grams, pr.raw_supplier_id,
            pr.care_instructions, pr.warranty_text, pr.seo_title, pr.seo_description)
           IS DISTINCT FROM
           (coalesce(p->>'descricao_curta', pr.short_description),
            coalesce(p->>'descricao', pr.description), coalesce(p->>'material', pr.material),
            coalesce(p->>'medidas', pr.measurements),
            coalesce((p->>'peso')::numeric, pr.weight_grams), coalesce(cat_id, pr.category_id),
            coalesce(sub_id, pr.subcategory_id),
            coalesce(col_id, pr.collection_id), coalesce(forn_id, pr.supplier_id),
            coalesce((p->>'preco_cents')::int, pr.price_cents),
            coalesce(p->>'material', pr.raw_material),
            coalesce((p->>'peso')::numeric, pr.raw_weight_grams),
            coalesce(forn_id, pr.raw_supplier_id),
            coalesce(p->>'cuidados', pr.care_instructions),
            coalesce(p->>'garantia', pr.warranty_text),
            coalesce(p->>'seo_titulo', pr.seo_title),
            coalesce(p->>'seo_descricao', pr.seo_description)) THEN
          e_prod := 'alterado';
          IF NOT j.dry_run THEN
            UPDATE public.products SET
              short_description = coalesce(p->>'descricao_curta', short_description),
              description = coalesce(p->>'descricao', description),
              material = coalesce(p->>'material', material),
              raw_material = coalesce(p->>'material', raw_material),
              plating = coalesce(p->>'banho', plating),
              measurements = coalesce(p->>'medidas', measurements),
              weight_grams = coalesce((p->>'peso')::numeric, weight_grams),
              raw_weight_grams = coalesce((p->>'peso')::numeric, raw_weight_grams),
              raw_supplier_id = coalesce(forn_id, raw_supplier_id),
              raw_piece_cost_cents = coalesce((p->>'valor_bruto_cents')::int, raw_piece_cost_cents),
              care_instructions = coalesce(p->>'cuidados', care_instructions),
              warranty_text = coalesce(p->>'garantia', warranty_text),
              seo_title = coalesce(p->>'seo_titulo', seo_title),
              seo_description = coalesce(p->>'seo_descricao', seo_description),
              category_id = coalesce(cat_id, category_id),
              subcategory_id = coalesce(sub_id, subcategory_id),
              collection_id = coalesce(col_id, collection_id),
              supplier_id = coalesce(forn_id, supplier_id),
              price_cents = coalesce((p->>'preco_cents')::int, price_cents),
              updated_at = now()
            WHERE id = prod_id;
          END IF;
        ELSE e_prod := 'sem_alteracao'; END IF;

      ELSIF prod_id IS NOT NULL AND NOT j.dry_run THEN
        e_prod := 'sem_alteracao';
        SELECT internal_code INTO interno FROM public.products WHERE id = prod_id;
        SELECT upper(sku_token) INTO token FROM public.plating_types WHERE id = plat_id;
        SELECT pv2.id INTO placeholder FROM public.product_variants pv2
         WHERE pv2.product_id = prod_id AND pv2.is_default
           AND pv2.sku IS NULL AND pv2.barcode IS NULL AND pv2.legacy_code IS NULL
           AND pv2.price_cents IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.variant_id = pv2.id)
         LIMIT 1;
        label_novo := coalesce(p->>'nome_variante',
          nullif(trim(nome || coalesce(' — '||(SELECT name FROM public.plating_types WHERE id=plat_id),'')
                           || coalesce(' — '||(p->>'tamanho'),'')),''), 'Única');
        sku_novo := coalesce(p->>'sku',
          nullif(coalesce(interno,'') || coalesce('-'||token,'') || coalesce('-'||upper(p->>'tamanho'),''),''));
        IF sku_novo IS NOT NULL AND EXISTS
           (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
          sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
        END IF;
        IF placeholder IS NOT NULL THEN
          UPDATE public.product_variants SET
            label = label_novo, sku = sku_novo, barcode = cod_barras,
            legacy_code = p->>'codigo_legado', size = p->>'tamanho', color = p->>'cor',
            price_cents = (p->>'preco_cents')::int, plating_type_id = plat_id,
            plating_supplier_id = forn_banho, varnish_name = p->>'verniz',
            final_weight_grams = (p->>'peso_final')::numeric,
            is_active = coalesce((p->>'variante_ativa')::boolean, true),
            updated_at = now()
          WHERE id = placeholder;
          v_id := placeholder; e_var := 'criada';
        ELSE
          INSERT INTO public.product_variants (
            product_id, label, sku, barcode, legacy_code, size, color, price_cents, position,
            is_active, is_default, plating_type_id, plating_supplier_id, varnish_name, final_weight_grams
          ) VALUES (
            prod_id, label_novo, sku_novo, cod_barras, p->>'codigo_legado',
            p->>'tamanho', p->>'cor', (p->>'preco_cents')::int,
            (SELECT coalesce(max(position),0)+1 FROM public.product_variants WHERE product_id = prod_id),
            coalesce((p->>'variante_ativa')::boolean, true),
            coalesce((p->>'variante_padrao')::boolean, false),
            plat_id, forn_banho, p->>'verniz', (p->>'peso_final')::numeric
          ) RETURNING id INTO v_id;
          e_var := 'criada';
        END IF;

      ELSIF prod_id IS NOT NULL THEN
        e_prod := 'sem_alteracao'; e_var := 'criada';

      ELSE
        novo_produto := true; e_prod := 'criado'; e_var := 'criada';
        IF NOT j.dry_run THEN
          base_slug := lower(regexp_replace(public.norm_name(nome),'[^a-z0-9]+','-','g'));
          interno := coalesce(p->>'codigo_interno', public.product_next_internal_code(cat_id));
          INSERT INTO public.products (
            name, slug, internal_code, legacy_code, category_id, subcategory_id, collection_id,
            supplier_id, short_description, description, material, plating, measurements,
            weight_grams, price_cents, price_is_public, is_featured, status,
            raw_material, raw_weight_grams, raw_supplier_id, raw_piece_cost_cents,
            care_instructions, warranty_text, seo_title, seo_description
          ) VALUES (
            nome, base_slug||'-'||substr(gen_random_uuid()::text,1,6), interno,
            coalesce(p->>'codigo_legado_produto', p->>'codigo_legado'),
            cat_id, sub_id, col_id, forn_id, p->>'descricao_curta', p->>'descricao',
            p->>'material', p->>'banho', p->>'medidas', (p->>'peso')::numeric,
            (p->>'preco_cents')::int, coalesce((p->>'mostrar_preco')::boolean,true),
            coalesce((p->>'destaque')::boolean,false), 'rascunho'::content_status,
            p->>'material', (p->>'peso')::numeric, forn_id, (p->>'valor_bruto_cents')::int,
            p->>'cuidados', p->>'garantia', p->>'seo_titulo', p->>'seo_descricao'
          ) RETURNING id INTO prod_id;

          SELECT upper(sku_token) INTO token FROM public.plating_types WHERE id = plat_id;
          label_novo := coalesce(p->>'nome_variante',
            nullif(trim(nome || coalesce(' — '||(SELECT name FROM public.plating_types WHERE id=plat_id),'')
                             || coalesce(' — '||(p->>'tamanho'),'')),''), 'Única');
          sku_novo := coalesce(p->>'sku',
            nullif(interno || coalesce('-'||token,'') || coalesce('-'||upper(p->>'tamanho'),''),''));
          IF sku_novo IS NOT NULL AND EXISTS
             (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
            sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
          END IF;

          SELECT pv2.id INTO placeholder FROM public.product_variants pv2
           WHERE pv2.product_id = prod_id AND pv2.is_default LIMIT 1;
          IF placeholder IS NOT NULL THEN
            UPDATE public.product_variants SET
              label = label_novo, sku = sku_novo, barcode = cod_barras,
              legacy_code = p->>'codigo_legado', size = p->>'tamanho', color = p->>'cor',
              price_cents = (p->>'preco_cents')::int, plating_type_id = plat_id,
              plating_supplier_id = forn_banho, varnish_name = p->>'verniz',
              final_weight_grams = (p->>'peso_final')::numeric,
              is_active = coalesce((p->>'variante_ativa')::boolean, true),
              updated_at = now()
            WHERE id = placeholder;
            v_id := placeholder;
          ELSE
            INSERT INTO public.product_variants (
              product_id, label, sku, barcode, legacy_code, size, color, price_cents, position,
              is_active, is_default, plating_type_id, plating_supplier_id, varnish_name, final_weight_grams
            ) VALUES (
              prod_id, label_novo, sku_novo, cod_barras, p->>'codigo_legado',
              p->>'tamanho', p->>'cor', (p->>'preco_cents')::int, 1,
              coalesce((p->>'variante_ativa')::boolean, true),
              coalesce((p->>'variante_padrao')::boolean, true),
              plat_id, forn_banho, p->>'verniz', (p->>'peso_final')::numeric
            ) RETURNING id INTO v_id;
          END IF;
        END IF;
      END IF;

      -- custo: nova vigência só quando algum valor muda de verdade
      IF (p->>'custo_cents') IS NOT NULL OR (p->>'valor_bruto_cents') IS NOT NULL
         OR (p->>'valor_banho_cents') IS NOT NULL OR (p->>'valor_verniz_cents') IS NOT NULL THEN
        c_bruto  := coalesce((p->>'valor_bruto_cents')::int, 0);
        c_banho  := coalesce((p->>'valor_banho_cents')::int, 0);
        c_verniz := coalesce((p->>'valor_verniz_cents')::int, 0);
        c_soma   := c_bruto + c_banho + c_verniz;
        c_final  := coalesce((p->>'custo_cents')::int, c_soma);
        ult := NULL;
        IF v_id IS NOT NULL THEN
          SELECT cost_cents, raw_piece_cost_cents, plating_material_cost_cents,
                 varnish_cost_cents, finished_piece_cost_cents
            INTO ult FROM public.variant_costs
           WHERE variant_id = v_id ORDER BY effective_from DESC, created_at DESC LIMIT 1;
        END IF;
        IF ult IS NULL
           OR ult.cost_cents IS DISTINCT FROM c_final
           OR coalesce(ult.raw_piece_cost_cents,0) IS DISTINCT FROM c_bruto
           OR coalesce(ult.plating_material_cost_cents,0) IS DISTINCT FROM c_banho
           OR coalesce(ult.varnish_cost_cents,0) IS DISTINCT FROM c_verniz THEN
          e_custo := 'inserido';
          IF NOT j.dry_run AND v_id IS NOT NULL THEN
            INSERT INTO public.variant_costs (
              variant_id, supplier_id, cost_cents, note, raw_supplier_id, raw_piece_cost_cents,
              plating_supplier_id, plating_material_cost_cents, varnish_name, varnish_cost_cents,
              finished_piece_cost_cents, components_total_cents, justification, created_by)
            VALUES (v_id, coalesce(forn_banho, forn_id), c_final,
              coalesce(p->>'observacao_custo', 'Importação '||j.job_key),
              forn_id, c_bruto, forn_banho, c_banho, p->>'verniz', c_verniz,
              c_final, c_soma, p->>'justificativa_custo', auth.uid());
            UPDATE public.product_variants SET
              plating_material_cost_cents = c_banho, varnish_cost_cents = c_verniz,
              finished_piece_cost_cents = c_final, updated_at = now()
            WHERE id = v_id;
          END IF;
        ELSE e_custo := 'sem_alteracao'; END IF;
      END IF;

      IF j.mode = 'entrada' AND qtd > 0 THEN
        idem := 'imp:'||coalesce(j.entry_key, j.id::text)||':'||r.line_no;
        IF EXISTS (SELECT 1 FROM public.stock_movements WHERE idempotency_key = idem) THEN
          e_estoque := 'ja_lancada';
          SELECT id INTO mov FROM public.stock_movements WHERE idempotency_key = idem;
        ELSIF j.dry_run THEN
          e_estoque := 'criada';
        ELSE
          mov := public.register_stock_movement(
            'entrada'::stock_move_kind, v_id, qtd, NULL, j.location_id,
            j.reason_code, (p->>'custo_cents')::int,
            coalesce(j.reference, j.job_key), 'Importação em massa '||j.job_key, idem);
          e_estoque := 'criada';
        END IF;
      END IF;

      IF coalesce((p->>'publicar')::boolean,false) THEN
        IF prod_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id=prod_id AND status='publicado') THEN
          pubst := 'ja_publicado';
        ELSIF NOT pode_publicar THEN
          pubst := 'recusada';
          msgs := msgs || jsonb_build_object('campo','publicar',
            'aviso','Peça salva como rascunho: seu perfil não tem permissão para publicar.',
            'correcao','Peça a alguém do Marketing ou da Diretoria para publicar pela Central da Vitrine.');
        ELSIF j.dry_run THEN
          pubst := 'prevista';
        ELSE
          pubres := public.publish_products(ARRAY[prod_id], 'Importação '||j.job_key);
          IF coalesce((pubres->>'afetados')::int,0) > 0 THEN
            pubst := 'publicado';
          ELSE
            pubst := 'recusada';
            msgs := msgs || jsonb_build_object('campo','publicar',
              'aviso','Peça salva como rascunho: a publicação foi recusada.',
              'faltando', pubres->'itens_rejeitados'->0->'faltando');
          END IF;
        END IF;
      END IF;

      ef := jsonb_build_object(
        'produto', e_prod, 'variante', e_var, 'chave', chave, 'duplicada', false,
        'categoria_criada', criou_cat, 'categoria_nome', p->>'categoria',
        'colecao_criada', criou_col, 'colecao_nome', p->>'colecao',
        'fornecedor_criado', criou_forn, 'fornecedor_nome', p->>'fornecedor',
        'formato', p->>'formato',
        'custo', e_custo, 'estoque', e_estoque,
        'unidades', CASE WHEN e_estoque IS NOT NULL THEN qtd ELSE 0 END,
        'simulado', j.dry_run);

      IF j.dry_run THEN
        UPDATE public.import_rows
           SET status='simulado', processed_at=now(), effects=ef, claimed_by=NULL, claim_until=NULL,
               publish_status = pubst, attempts = attempts + 1,
               messages = msgs || jsonb_build_array(jsonb_build_object('aviso','Simulação: nada foi gravado.'))
         WHERE id = r.id;
      ELSE
        UPDATE public.import_rows
           SET status='processado', processed_at=now(), product_id=prod_id, variant_id=v_id,
               movement_id=mov, attempts = attempts + 1, effects = ef, publish_status = pubst,
               messages = msgs, claimed_by=NULL, claim_until=NULL
         WHERE id = r.id;
      END IF;
      feitas := feitas + 1;

    EXCEPTION WHEN others THEN
      UPDATE public.import_rows
         SET status='erro', attempts = attempts + 1, claimed_by=NULL, claim_until=NULL,
             error_code = SQLSTATE,
             messages = coalesce(messages,'[]'::jsonb) || jsonb_build_array(
               jsonb_build_object('erro', SQLERRM, 'codigo', SQLSTATE))
       WHERE id = r.id;
      erradas := erradas + 1;
    END;
  END LOOP;

  SELECT count(*) INTO restantes FROM public.import_rows
   WHERE job_id=_job AND status IN ('valido','aviso','pendente','processando');
  SELECT count(*) INTO com_erro FROM public.import_rows
   WHERE job_id=_job AND status IN ('erro','conflito');

  UPDATE public.import_jobs SET
      processed_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('processado','simulado')),
      ok_rows        = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('processado','simulado')),
      warn_rows      = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows     = com_erro,
      checkpoint_line = greatest(checkpoint_line,
                        (SELECT coalesce(max(line_no),0) FROM public.import_rows
                          WHERE job_id=_job AND status IN ('processado','simulado'))),
      products_created = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'produto'='criado'),
      products_updated = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'produto'='alterado'),
      variants_created = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'variante'='criada'),
      variants_updated = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'variante'='alterada'),
      stock_entries    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'estoque'='criada'),
      units_in         = (SELECT coalesce(sum(coalesce((effects->>'unidades')::int,0)),0)
                            FROM public.import_rows WHERE job_id=_job AND effects->>'estoque'='criada'),
      status = CASE
                 WHEN restantes > 0 THEN status
                 WHEN dry_run THEN 'simulado'
                 WHEN com_erro > 0 THEN 'concluido_com_erros'
                 ELSE 'concluido' END,
      simulated_at = CASE WHEN dry_run AND restantes = 0 THEN now() ELSE simulated_at END,
      finished_at = CASE WHEN restantes = 0 AND NOT dry_run THEN now() ELSE finished_at END
   WHERE id = _job;

  RETURN jsonb_build_object('processadas', feitas, 'erros_no_lote', erradas,
    'restantes', restantes, 'worker', w, 'indicadores', public.import_job_counters(_job));
END $function$;

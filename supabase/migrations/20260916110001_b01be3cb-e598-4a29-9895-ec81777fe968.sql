DO $mig$
DECLARE src text; novo text; velho text;
BEGIN
  -- 1) conferência: recusar código que pertence a outro produto
  src := pg_get_functiondef('public.import_job_validate(uuid,integer)'::regprocedure);
  velho := '      ELSE
        p := p || jsonb_build_object(''variant_id'', coalesce(v_ean, v_sku, v_leg));
      END IF;';
  IF position(velho in src) = 0 THEN RAISE EXCEPTION 'ancora 1 nao encontrada'; END IF;
  novo := '      ELSE
        p := p || jsonb_build_object(''variant_id'', coalesce(v_ean, v_sku, v_leg));
        IF coalesce(v_ean, v_sku, v_leg) IS NOT NULL THEN
          txt := NULL;
          SELECT pr2.name || '' — '' || coalesce(pv2.label,''variante'')
            INTO txt
            FROM public.product_variants pv2
            JOIN public.products pr2 ON pr2.id = pv2.product_id
           WHERE pv2.id = coalesce(v_ean, v_sku, v_leg)
             AND public.norm_name(pr2.name) IS DISTINCT FROM public.norm_name(c_nome)
             AND ((p->>''codigo_interno'') IS NULL
                  OR upper(coalesce(pr2.internal_code,'''')) <> upper(p->>''codigo_interno''))
             AND ((p->>''codigo_legado_produto'') IS NULL
                  OR upper(coalesce(pr2.legacy_code,'''')) <> upper(p->>''codigo_legado_produto''));
          IF txt IS NOT NULL THEN
            st := ''conflito'';
            msgs := msgs || jsonb_build_object(
              ''campo'', CASE WHEN v_ean IS NOT NULL THEN ''ean'' ELSE ''sku'' END,
              ''valor'', coalesce(c_ean, c_sku),
              ''erro'', ''Este código já é usado por '' || txt || ''.'',
              ''correcao'', ''Corrija o código desta linha ou informe o código do produto correto.'');
            txt := NULL;
          END IF;
        END IF;
      END IF;';
  EXECUTE replace(src, velho, novo);

  -- 2) processamento: agrupar linhas do mesmo produto dentro do lote
  src := pg_get_functiondef('public.import_job_process(uuid,integer,uuid)'::regprocedure);
  velho := '      IF v_id IS NOT NULL THEN
        SELECT * INTO pv FROM public.product_variants WHERE id = v_id;';
  IF position(velho in src) = 0 THEN RAISE EXCEPTION 'ancora 2 nao encontrada'; END IF;
  novo := '      IF v_id IS NULL AND prod_id IS NULL AND nome IS NOT NULL THEN
        SELECT x.product_id INTO prod_id
          FROM public.import_rows x
         WHERE x.job_id = _job AND x.id <> r.id AND x.product_id IS NOT NULL
           AND public.norm_name(x.parsed->>''nome'') = public.norm_name(nome)
         ORDER BY x.line_no LIMIT 1;
      END IF;

      IF v_id IS NOT NULL THEN
        SELECT * INTO pv FROM public.product_variants WHERE id = v_id;';
  src := replace(src, velho, novo);

  -- 3) SKU gerado: sufixo previsível em vez de aleatório
  velho := '            sku_novo := sku_novo || ''-'' || substr(md5(gen_random_uuid()::text),1,4);';
  IF position(velho in src) = 0 THEN RAISE EXCEPTION 'ancora 3 nao encontrada'; END IF;
  novo := '            sku_novo := sku_novo || ''-'' ||
              (1 + (SELECT count(*) FROM public.product_variants x
                     WHERE upper(x.sku) LIKE upper(sku_novo) || ''-%''))::text;
            IF EXISTS (SELECT 1 FROM public.product_variants WHERE upper(sku) = upper(sku_novo)) THEN
              RAISE EXCEPTION ''Não foi possível gerar um SKU único para %.'', nome USING ERRCODE = ''23505'';
            END IF;';
  src := replace(src, velho, novo);
  velho := '          sku_novo := sku_novo || ''-'' || substr(md5(gen_random_uuid()::text),1,4);';
  novo := '          sku_novo := sku_novo || ''-'' ||
            (1 + (SELECT count(*) FROM public.product_variants x
                   WHERE upper(x.sku) LIKE upper(sku_novo) || ''-%''))::text;
          IF EXISTS (SELECT 1 FROM public.product_variants WHERE upper(sku) = upper(sku_novo)) THEN
            RAISE EXCEPTION ''Não foi possível gerar um SKU único para %.'', nome USING ERRCODE = ''23505'';
          END IF;';
  src := replace(src, velho, novo);
  EXECUTE src;
END $mig$;
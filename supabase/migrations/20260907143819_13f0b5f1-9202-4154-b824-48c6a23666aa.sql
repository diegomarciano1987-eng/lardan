CREATE OR REPLACE FUNCTION public.import_row_conflict(_v uuid, _legado text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT _v IS NOT NULL AND nullif(trim(coalesce(_legado,'')),'') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
        WHERE v.id = _v
          AND coalesce(upper(p.legacy_code), upper(v.legacy_code), upper(_legado))
              IS DISTINCT FROM upper(_legado));
$$;

CREATE OR REPLACE FUNCTION public.import_job_process(_job uuid, _limit integer DEFAULT 200, _worker uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j public.import_jobs; r record; p jsonb; w uuid := coalesce(_worker, gen_random_uuid());
        pr public.products; pv public.product_variants;
        v_id uuid; prod_id uuid; cat_id uuid; col_id uuid; forn_id uuid; placeholder uuid;
        qtd int; mov uuid; ef jsonb; pubres jsonb; pubst text; msgs jsonb;
        feitas int := 0; erradas int := 0; restantes int; com_erro int; nome text; base_slug text;
        criou_cat boolean; criou_col boolean; criou_forn boolean; novo_produto boolean;
        chave text; dup boolean; e_prod text; e_var text; e_custo text; e_estoque text;
        custo_atual int; idem text; label_novo text; pode_publicar boolean;
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
  IF j.status IN ('cancelado','concluido','concluido_com_erros') THEN
    RAISE EXCEPTION 'Lote encerrado (%).', j.status;
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
      chave := upper(coalesce(p->>'codigo_legado', p->>'sku', p->>'ean', nome));

      SELECT EXISTS (SELECT 1 FROM public.import_rows x
                      WHERE x.job_id=_job AND x.id <> r.id AND x.line_no < r.line_no
                        AND x.status IN ('processado','simulado')
                        AND upper(coalesce(x.parsed->>'codigo_legado', x.parsed->>'sku',
                                           x.parsed->>'ean', x.parsed->>'nome')) = chave)
        INTO dup;

      IF dup THEN
        UPDATE public.import_rows
           SET status='conflito', error_code='duplicada_no_arquivo', attempts = attempts + 1,
               claimed_by=NULL, claim_until=NULL, processed_at=now(),
               effects = jsonb_build_object('produto','recusado','variante','recusada',
                                            'chave', chave, 'duplicada', true, 'simulado', j.dry_run),
               messages = msgs || jsonb_build_array(jsonb_build_object(
                 'campo','identificacao',
                 'erro','Esta linha repete a identificação de outra linha do mesmo arquivo.',
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

      cat_id := NULL; col_id := NULL; forn_id := NULL;
      IF p->>'categoria' IS NOT NULL THEN
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
      IF p->>'fornecedor' IS NOT NULL THEN
        SELECT id INTO forn_id FROM public.suppliers
          WHERE public.norm_name(name)=public.norm_name(p->>'fornecedor') LIMIT 1;
        IF forn_id IS NULL THEN
          criou_forn := true;
          IF NOT j.dry_run THEN
            INSERT INTO public.suppliers (name) VALUES (p->>'fornecedor')
            ON CONFLICT (public.norm_name(name)) DO NOTHING
            RETURNING id INTO forn_id;
            IF forn_id IS NULL THEN
              criou_forn := false;
              SELECT id INTO forn_id FROM public.suppliers
                WHERE public.norm_name(name)=public.norm_name(p->>'fornecedor') LIMIT 1;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_id IS NULL AND p->>'codigo_legado' IS NOT NULL THEN
        SELECT id INTO prod_id FROM public.products
         WHERE upper(legacy_code) = upper(p->>'codigo_legado') LIMIT 1;
      END IF;

      IF v_id IS NOT NULL THEN
        SELECT * INTO pv FROM public.product_variants WHERE id = v_id;
        prod_id := pv.product_id;
        SELECT * INTO pr FROM public.products WHERE id = prod_id;

        IF (pv.sku, pv.barcode, pv.legacy_code, pv.size, pv.color, pv.price_cents) IS DISTINCT FROM
           (coalesce(p->>'sku', pv.sku), coalesce(p->>'ean', pv.barcode),
            coalesce(p->>'codigo_legado', pv.legacy_code), coalesce(p->>'tamanho', pv.size),
            coalesce(p->>'cor', pv.color), coalesce((p->>'preco_cents')::int, pv.price_cents)) THEN
          e_var := 'alterada';
          IF NOT j.dry_run THEN
            UPDATE public.product_variants SET
              sku = coalesce(p->>'sku', sku), barcode = coalesce(p->>'ean', barcode),
              legacy_code = coalesce(p->>'codigo_legado', legacy_code),
              size = coalesce(p->>'tamanho', size), color = coalesce(p->>'cor', color),
              price_cents = coalesce((p->>'preco_cents')::int, price_cents), updated_at = now()
            WHERE id = v_id;
          END IF;
        ELSE e_var := 'sem_alteracao'; END IF;

        IF (pr.short_description, pr.description, pr.material, pr.plating, pr.measurements,
            pr.weight_grams, pr.category_id, pr.collection_id, pr.supplier_id, pr.price_cents)
           IS DISTINCT FROM
           (coalesce(p->>'descricao_curta', pr.short_description),
            coalesce(p->>'descricao', pr.description), coalesce(p->>'material', pr.material),
            coalesce(p->>'banho', pr.plating), coalesce(p->>'medidas', pr.measurements),
            coalesce((p->>'peso')::numeric, pr.weight_grams), coalesce(cat_id, pr.category_id),
            coalesce(col_id, pr.collection_id), coalesce(forn_id, pr.supplier_id),
            coalesce((p->>'preco_cents')::int, pr.price_cents)) THEN
          e_prod := 'alterado';
          IF NOT j.dry_run THEN
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
          END IF;
        ELSE e_prod := 'sem_alteracao'; END IF;

      ELSIF prod_id IS NOT NULL AND NOT j.dry_run THEN
        e_prod := 'sem_alteracao';
        SELECT pv2.id INTO placeholder FROM public.product_variants pv2
         WHERE pv2.product_id = prod_id AND pv2.is_default
           AND pv2.sku IS NULL AND pv2.barcode IS NULL AND pv2.legacy_code IS NULL
           AND pv2.price_cents IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.variant_id = pv2.id)
         LIMIT 1;
        label_novo := coalesce(nullif(trim(coalesce(p->>'tamanho','')||' '||coalesce(p->>'cor','')),''),'Único');
        IF placeholder IS NOT NULL THEN
          UPDATE public.product_variants SET
            label = label_novo, sku = p->>'sku', barcode = p->>'ean',
            legacy_code = p->>'codigo_legado', size = p->>'tamanho', color = p->>'cor',
            price_cents = (p->>'preco_cents')::int, updated_at = now()
          WHERE id = placeholder;
          v_id := placeholder; e_var := 'criada';
        ELSE
          INSERT INTO public.product_variants (
            product_id, label, sku, barcode, legacy_code, size, color, price_cents, position, is_active
          ) VALUES (
            prod_id, label_novo||' '||substr(md5(coalesce(p->>'sku', p->>'ean', p->>'codigo_legado','')),1,4),
            p->>'sku', p->>'ean', p->>'codigo_legado', p->>'tamanho', p->>'cor',
            (p->>'preco_cents')::int,
            (SELECT coalesce(max(position),0)+1 FROM public.product_variants WHERE product_id = prod_id),
            true
          ) RETURNING id INTO v_id;
          e_var := 'criada';
        END IF;

      ELSIF prod_id IS NOT NULL THEN
        e_prod := 'sem_alteracao'; e_var := 'criada';

      ELSE
        novo_produto := true; e_prod := 'criado'; e_var := 'criada';
        IF NOT j.dry_run THEN
          base_slug := lower(regexp_replace(public.norm_name(nome),'[^a-z0-9]+','-','g'));
          INSERT INTO public.products (
            name, slug, legacy_code, category_id, collection_id, supplier_id,
            short_description, description, material, plating, measurements,
            weight_grams, price_cents, price_is_public, is_featured, status
          ) VALUES (
            nome, base_slug||'-'||substr(gen_random_uuid()::text,1,6), p->>'codigo_legado',
            cat_id, col_id, forn_id, p->>'descricao_curta', p->>'descricao',
            p->>'material', p->>'banho', p->>'medidas', (p->>'peso')::numeric,
            (p->>'preco_cents')::int, coalesce((p->>'mostrar_preco')::boolean,true),
            coalesce((p->>'destaque')::boolean,false), 'rascunho'::content_status
          ) RETURNING id INTO prod_id;

          SELECT pv2.id INTO placeholder FROM public.product_variants pv2
           WHERE pv2.product_id = prod_id AND pv2.is_default LIMIT 1;
          label_novo := coalesce(nullif(trim(coalesce(p->>'tamanho','')||' '||coalesce(p->>'cor','')),''),'Único');
          IF placeholder IS NOT NULL THEN
            UPDATE public.product_variants SET
              label = label_novo, sku = p->>'sku', barcode = p->>'ean',
              legacy_code = p->>'codigo_legado', size = p->>'tamanho', color = p->>'cor',
              price_cents = (p->>'preco_cents')::int, updated_at = now()
            WHERE id = placeholder;
            v_id := placeholder;
          ELSE
            INSERT INTO public.product_variants (
              product_id, label, sku, barcode, legacy_code, size, color, price_cents, position, is_active
            ) VALUES (
              prod_id, label_novo, p->>'sku', p->>'ean', p->>'codigo_legado',
              p->>'tamanho', p->>'cor', (p->>'preco_cents')::int, 1, true
            ) RETURNING id INTO v_id;
          END IF;
        END IF;
      END IF;

      IF (p->>'custo_cents') IS NOT NULL THEN
        custo_atual := NULL;
        IF v_id IS NOT NULL THEN
          SELECT cost_cents INTO custo_atual FROM public.variant_costs
           WHERE variant_id = v_id ORDER BY effective_from DESC, created_at DESC LIMIT 1;
        END IF;
        IF custo_atual IS DISTINCT FROM (p->>'custo_cents')::int THEN
          e_custo := 'inserido';
          IF NOT j.dry_run THEN
            INSERT INTO public.variant_costs (variant_id, supplier_id, cost_cents, note)
            VALUES (v_id, forn_id, (p->>'custo_cents')::int, 'Importação '||j.job_key);
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
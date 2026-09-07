CREATE OR REPLACE FUNCTION public.import_job_validate(_job uuid, _limit integer DEFAULT 500)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j public.import_jobs; r record; m jsonb; d jsonb; p jsonb; msgs jsonb; st text;
        c_sku text; c_leg text; c_ean text; c_nome text; q_raw text; q_num numeric;
        v_sku uuid; v_leg uuid; v_ean uuid; alvos uuid[];
        pode_custo boolean; custo int; preco int; feitas int := 0; vazia boolean;
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
  IF j.status IN ('recebendo','recebido') THEN
    UPDATE public.import_jobs SET status = CASE WHEN status='recebendo' THEN 'recebido' ELSE status END WHERE id=_job;
    UPDATE public.import_jobs SET status='validando' WHERE id=_job;
  END IF;
  m := j.mapping; d := j.defaults;
  pode_custo := public.has_capability(auth.uid(),'catalog.cost.view');

  FOR r IN SELECT * FROM public.import_rows
            WHERE job_id = _job AND status = 'pendente'
            ORDER BY line_no LIMIT greatest(coalesce(_limit,500),1)
            FOR UPDATE SKIP LOCKED
  LOOP
    msgs := '[]'::jsonb; st := 'valido';

    SELECT NOT EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(r.raw,'{}'::jsonb)) kv
                        WHERE nullif(trim(coalesce(kv.value,'')),'') IS NOT NULL)
      INTO vazia;
    IF vazia THEN
      UPDATE public.import_rows
         SET status='ignorado', error_code='linha_vazia', parsed=NULL,
             messages = jsonb_build_array(jsonb_build_object('aviso','Linha vazia ignorada.'))
       WHERE id = r.id;
      feitas := feitas + 1;
      CONTINUE;
    END IF;

    q_raw := nullif(trim(coalesce(r.raw->>(m->>'quantidade'), d->>'quantidade','')),'');
    q_num := public.parse_decimal_any(q_raw);
    custo := public.parse_cents_any(r.raw->>(m->>'custo'));
    preco := public.parse_cents_any(coalesce(r.raw->>(m->>'preco'), d->>'preco'));

    p := jsonb_build_object(
      'nome',        coalesce(nullif(trim(coalesce(r.raw->>(m->>'nome'),'')),''), d->>'nome'),
      'descricao_curta', nullif(trim(coalesce(r.raw->>(m->>'descricao_curta'),'')),''),
      'descricao',   nullif(trim(coalesce(r.raw->>(m->>'descricao'),'')),''),
      'categoria',   coalesce(nullif(trim(coalesce(r.raw->>(m->>'categoria'),'')),''), d->>'categoria'),
      'colecao',     coalesce(nullif(trim(coalesce(r.raw->>(m->>'colecao'),'')),''), d->>'colecao'),
      'fornecedor',  coalesce(nullif(trim(coalesce(r.raw->>(m->>'fornecedor'),'')),''), d->>'fornecedor'),
      'material',    coalesce(nullif(trim(coalesce(r.raw->>(m->>'material'),'')),''), d->>'material'),
      'banho',       coalesce(nullif(trim(coalesce(r.raw->>(m->>'banho'),'')),''), d->>'banho'),
      'cor',         nullif(trim(coalesce(r.raw->>(m->>'cor'),'')),''),
      'tamanho',     nullif(trim(coalesce(r.raw->>(m->>'tamanho'),'')),''),
      'peso',        public.parse_decimal_any(r.raw->>(m->>'peso')),
      'medidas',     nullif(trim(coalesce(r.raw->>(m->>'medidas'),'')),''),
      'sku',         public.norm_code(r.raw->>(m->>'sku')),
      'codigo_legado', public.norm_code(r.raw->>(m->>'codigo_legado')),
      'ean',         public.norm_code(r.raw->>(m->>'ean')),
      'custo_cents', CASE WHEN pode_custo THEN custo ELSE NULL END,
      'preco_cents', preco,
      'quantidade',  coalesce(q_num,0)::int,
      'destaque',    lower(coalesce(r.raw->>(m->>'destaque'), d->>'destaque','')) IN ('1','sim','true','x','s'),
      'publicar',    lower(coalesce(r.raw->>(m->>'publicar'), d->>'publicar','')) IN ('1','sim','true','x','s'),
      'mostrar_preco', lower(coalesce(r.raw->>(m->>'mostrar_preco'), d->>'mostrar_preco','sim')) IN ('1','sim','true','x','s'),
      'imagem_url',  nullif(trim(coalesce(r.raw->>(m->>'imagem_url'),'')),'')
    );

    c_nome := p->>'nome'; c_sku := p->>'sku'; c_leg := p->>'codigo_legado'; c_ean := p->>'ean';

    IF c_nome IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','nome','erro','Nome do produto é obrigatório.',
        'correcao','Preencha a coluna do nome.');
    END IF;
    IF c_sku IS NULL AND c_leg IS NULL AND c_ean IS NULL THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','identificador',
        'erro','Informe ao menos SKU, código legado ou código de barras.',
        'correcao','Preencha um código que identifique a peça.');
    END IF;
    IF custo IS NOT NULL AND custo < 0 THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','custo',
        'erro','Custo negativo não é aceito.','correcao','Informe um custo igual ou maior que zero.');
    END IF;
    IF preco IS NOT NULL AND preco < 0 THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','preco',
        'erro','Preço negativo não é aceito.','correcao','Informe um preço igual ou maior que zero.');
    END IF;
    IF custo IS NOT NULL AND NOT pode_custo THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','custo','aviso','Custo ignorado: seu perfil não tem acesso a custo.');
    END IF;
    IF q_raw IS NOT NULL AND (q_num IS NULL OR q_num < 0 OR q_num <> trunc(q_num)) THEN
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','quantidade','valor',left(q_raw,40),
        'erro','Quantidade precisa ser um número inteiro igual ou maior que zero.',
        'correcao','Use apenas números inteiros, sem sinal negativo.');
    END IF;
    IF j.mode = 'catalogo' AND coalesce(q_num,0) > 0 THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','quantidade',
        'aviso','Somente cadastro: a quantidade desta linha não movimenta estoque.');
    END IF;
    IF j.mode = 'entrada' AND coalesce(q_num,0) = 0 THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','quantidade',
        'aviso','Quantidade zero: a peça é cadastrada sem entrada de estoque.');
    END IF;
    IF (p->>'imagem_url') IS NOT NULL THEN
      IF st = 'valido' THEN st := 'aviso'; END IF;
      msgs := msgs || jsonb_build_object('campo','imagem_url',
        'aviso','Endereço de imagem recebido, mas a importação de imagens ainda não está liberada: o endereço NÃO foi acessado e nenhuma imagem foi baixada.',
        'correcao','Suba a imagem pela Central da Vitrine depois da importação.');
    END IF;

    IF st <> 'erro' THEN
      v_sku := NULL; v_leg := NULL; v_ean := NULL;
      IF c_sku IS NOT NULL THEN
        SELECT pv.id INTO v_sku FROM public.product_variants pv WHERE upper(pv.sku) = upper(c_sku) LIMIT 1;
      END IF;
      IF c_leg IS NOT NULL THEN
        SELECT pv.id INTO v_leg FROM public.product_variants pv WHERE upper(pv.legacy_code) = upper(c_leg) LIMIT 1;
      END IF;
      IF c_ean IS NOT NULL THEN
        SELECT pv.id INTO v_ean FROM public.product_variants pv WHERE pv.barcode = c_ean LIMIT 1;
      END IF;
      alvos := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_sku, v_leg, v_ean]) x WHERE x IS NOT NULL);
      IF array_length(alvos,1) > 1 THEN
        st := 'conflito';
        msgs := msgs || jsonb_build_object('campo','identificador',
          'erro','Os códigos desta linha apontam para peças diferentes. Linha bloqueada para revisão manual.',
          'correcao','Corrija os códigos para que apontem para a mesma peça.',
          'registros', to_jsonb(alvos));
      ELSE
        p := p || jsonb_build_object('variant_id', coalesce(v_sku, v_leg, v_ean));
      END IF;
    END IF;

    UPDATE public.import_rows
       SET parsed = p, status = st, messages = msgs,
           error_code = CASE WHEN st IN ('erro','conflito') THEN msgs->0->>'campo' END
     WHERE id = r.id;
    feitas := feitas + 1;
  END LOOP;

  UPDATE public.import_jobs j2 SET
      ok_rows    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso','processado')),
      warn_rows  = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('erro','conflito')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows WHERE job_id=_job AND status='pendente')
                    THEN 'validando' ELSE 'pronto' END
    WHERE j2.id = _job AND j2.status = 'validando';

  RETURN jsonb_build_object('validadas', feitas,
    'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='pendente'),
    'indicadores', public.import_job_counters(_job));
END $function$;


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
        custo_atual int; idem text; mudou int; label_novo text;
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
  IF j.status = 'pausando' THEN
    UPDATE public.import_jobs SET status='pausado', paused_at=now() WHERE id=_job AND status='pausando';
    RETURN jsonb_build_object('pausado', true, 'processadas', 0,
      'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso')),
      'indicadores', public.import_job_counters(_job));
  END IF;
  IF j.status = 'pausado' THEN RAISE EXCEPTION 'Lote pausado: retome antes de processar.'; END IF;

  -- só um processador por lote (trava real de transação)
  IF NOT pg_try_advisory_xact_lock(hashtextextended('lardan.import:'||_job::text, 0)) THEN
    RETURN jsonb_build_object('processadas', 0, 'ocupado', true,
      'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','aviso')),
      'indicadores', public.import_job_counters(_job));
  END IF;

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
      e_custo := NULL; e_estoque := NULL;
      chave := upper(coalesce(p->>'codigo_legado', p->>'sku', p->>'ean', nome));

      SELECT EXISTS (SELECT 1 FROM public.import_rows x
                      WHERE x.job_id=_job AND x.id <> r.id AND x.line_no < r.line_no
                        AND x.status IN ('processado','simulado')
                        AND upper(coalesce(x.parsed->>'codigo_legado', x.parsed->>'sku',
                                           x.parsed->>'ean', x.parsed->>'nome')) = chave)
        INTO dup;

      -- taxonomias: localizar sempre; criar apenas na execução real
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

      -- custo: histórico só quando o valor muda
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

      -- estoque: idempotente pela identidade da entrada, não pelo lote
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

      -- publicação exclusivamente pela operação canônica
      IF coalesce((p->>'publicar')::boolean,false) THEN
        IF prod_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.products WHERE id=prod_id AND status='publicado') THEN
          pubst := 'ja_publicado';
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
        'produto', e_prod, 'variante', e_var, 'chave', chave, 'duplicada', dup,
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


CREATE OR REPLACE FUNCTION public.import_job_cancel(_job uuid, _motivo text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j public.import_jobs; aplicado jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  IF nullif(trim(coalesce(_motivo,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.responsible_user_id IS DISTINCT FROM auth.uid()
     AND NOT (public.has_role(auth.uid(),'master') OR public.has_role(auth.uid(),'diretoria')) THEN
    RAISE EXCEPTION 'Lote fora do seu escopo.' USING ERRCODE='42501';
  END IF;
  IF j.status IN ('cancelado','concluido','concluido_com_erros') THEN
    RAISE EXCEPTION 'Lote já encerrado (%).', j.status;
  END IF;
  aplicado := public.import_job_counters(_job);
  UPDATE public.import_rows SET status='ignorado', error_code='cancelada',
         claimed_by=NULL, claim_until=NULL
   WHERE job_id=_job AND status IN ('pendente','valido','aviso','processando');
  UPDATE public.import_jobs SET status='cancelado', cancel_reason=_motivo, finished_at=now() WHERE id=_job;
  PERFORM public.import_audit('importacao.cancelar', _job,
    jsonb_build_object('motivo', _motivo, 'ja_aplicado', aplicado));
  RETURN jsonb_build_object('status','cancelado','ja_aplicado', aplicado);
END $function$;
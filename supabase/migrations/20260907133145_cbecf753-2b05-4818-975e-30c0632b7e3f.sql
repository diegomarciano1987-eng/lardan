-- =========================================================
-- LARDAN Cloud — Importação Industrial v2 (operação)
-- =========================================================

CREATE OR REPLACE FUNCTION public.import_audit(_acao text, _job uuid, _payload jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, payload)
  VALUES (auth.uid(), _acao, 'import_jobs', _job::text, coalesce(_payload,'{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.import_audit(text,uuid,jsonb) FROM public, anon, authenticated;

-- ---------- 1. arquivo ----------
CREATE OR REPLACE FUNCTION public.import_file_register(
  _sha text, _file_name text, _byte_size bigint, _content_type text,
  _headers jsonb, _row_count integer, _column_count integer, _parser text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.import_files; novo boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  IF _sha IS NULL OR _sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Impressão digital do arquivo inválida.';
  END IF;
  SELECT * INTO f FROM public.import_files WHERE sha256 = _sha;
  IF NOT FOUND THEN
    INSERT INTO public.import_files (sha256, file_name, byte_size, content_type,
      headers, header_hash, row_count, column_count, parser_version)
    VALUES (_sha, coalesce(_file_name,'planilha'), coalesce(_byte_size,0), _content_type,
      coalesce(_headers,'[]'::jsonb), md5(coalesce(_headers,'[]'::jsonb)::text),
      coalesce(_row_count,0), coalesce(_column_count,0), coalesce(_parser,'xlsx-1'))
    RETURNING * INTO f;
    novo := true;
  END IF;
  RETURN jsonb_build_object('id', f.id, 'novo', novo, 'sha256', f.sha256,
    'linhas', f.row_count, 'cabecalhos', f.headers, 'enviado_em', f.created_at);
END $$;
REVOKE ALL ON FUNCTION public.import_file_register(text,text,bigint,text,jsonb,integer,integer,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_file_register(text,text,bigint,text,jsonb,integer,integer,text) TO authenticated;

-- ---------- 2. execução ----------
CREATE OR REPLACE FUNCTION public.import_job_open2(
  _file uuid, _mode text, _mapping jsonb, _defaults jsonb, _dry_run boolean,
  _location_id uuid DEFAULT NULL, _operation_date date DEFAULT NULL,
  _reason_code text DEFAULT NULL, _reference text DEFAULT NULL,
  _template_id uuid DEFAULT NULL, _template_version integer DEFAULT NULL,
  _simulation_of uuid DEFAULT NULL, _correction_of uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.import_files; j public.import_jobs; chave text; n int := 0; reaproveitado boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO f FROM public.import_files WHERE id = _file;
  IF NOT FOUND THEN RAISE EXCEPTION 'Arquivo não registrado.'; END IF;
  IF coalesce(_mode,'catalogo') NOT IN ('catalogo','entrada') THEN
    RAISE EXCEPTION 'Modo inválido.';
  END IF;

  IF _mode = 'entrada' AND NOT coalesce(_dry_run,false) THEN
    IF _location_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM public.locations WHERE id = _location_id AND is_active) THEN
      RAISE EXCEPTION 'Informe um local de entrada ativo.';
    END IF;
    IF _operation_date IS NULL THEN RAISE EXCEPTION 'Informe a data operacional.'; END IF;
    IF nullif(trim(coalesce(_reference,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Informe o documento ou referência da entrada.';
    END IF;
  END IF;

  IF _simulation_of IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.import_jobs WHERE id=_simulation_of AND dry_run AND status='simulado') THEN
      RAISE EXCEPTION 'A execução real só nasce de uma simulação aprovada.';
    END IF;
  END IF;

  chave := 'F' || left(f.sha256, 16) || ':' || coalesce(_mode,'catalogo')
         || CASE WHEN coalesce(_dry_run,false) THEN ':sim' ELSE ':real' END
         || ':' || left(md5(coalesce(_mapping,'{}')::text || coalesce(_defaults,'{}')::text
              || coalesce(_location_id::text,'') || coalesce(_operation_date::text,'')
              || coalesce(_reference,'') || coalesce(_correction_of::text,'')), 12);

  SELECT * INTO j FROM public.import_jobs WHERE job_key = chave
     AND status NOT IN ('concluido','concluido_com_erros','cancelado')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', j.id, 'reaproveitado', true, 'status', j.status,
      'linhas', j.total_rows, 'chave', j.job_key);
  END IF;

  SELECT count(*) INTO n FROM public.import_jobs WHERE job_key LIKE chave || '%';
  IF n > 0 THEN chave := chave || '#' || (n+1)::text; END IF;

  INSERT INTO public.import_jobs (
    job_key, file_id, file_name, file_size, mode, mapping, defaults, dry_run,
    location_id, operation_date, reason_code, reference, responsible_user_id,
    template_id, template_version, simulation_of, correction_of,
    base_fingerprint, status
  ) VALUES (
    chave, f.id, f.file_name, least(f.byte_size, 2147483647)::int, coalesce(_mode,'catalogo'),
    coalesce(_mapping,'{}'::jsonb), coalesce(_defaults,'{}'::jsonb), coalesce(_dry_run,false),
    _location_id, _operation_date, _reason_code, nullif(trim(coalesce(_reference,'')),''), auth.uid(),
    _template_id, _template_version, _simulation_of, _correction_of,
    (SELECT md5(count(*)::text || coalesce(max(updated_at)::text,'')) FROM public.products),
    'recebendo'
  ) RETURNING * INTO j;

  PERFORM public.import_audit('importacao.abrir', j.id, jsonb_build_object(
    'arquivo', f.sha256, 'modo', j.mode, 'simulacao', j.dry_run, 'chave', j.job_key));
  RETURN jsonb_build_object('id', j.id, 'reaproveitado', false, 'status', j.status,
    'linhas', 0, 'chave', j.job_key);
END $$;
REVOKE ALL ON FUNCTION public.import_job_open2(uuid,text,jsonb,jsonb,boolean,uuid,date,text,text,uuid,integer,uuid,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_open2(uuid,text,jsonb,jsonb,boolean,uuid,date,text,text,uuid,integer,uuid,uuid) TO authenticated;

-- ---------- 3. recepção das linhas ----------
CREATE OR REPLACE FUNCTION public.import_rows_stage(_job uuid, _rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer; j public.import_jobs;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.status NOT IN ('rascunho','recebendo') THEN
    RAISE EXCEPTION 'Este lote não aceita mais linhas (situação: %).', j.status;
  END IF;

  WITH src AS (
    SELECT (e->>'n')::int AS line_no, e->'raw' AS raw FROM jsonb_array_elements(_rows) e
  ), ins AS (
    INSERT INTO public.import_rows (job_id, line_no, raw)
    SELECT _job, line_no, raw FROM src
    ON CONFLICT (job_id, line_no) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO n FROM ins;

  UPDATE public.import_jobs
     SET total_rows = (SELECT count(*) FROM public.import_rows r WHERE r.job_id = _job)
   WHERE id = _job;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.import_job_seal(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; esperadas int; recebidas int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  SELECT count(*) INTO recebidas FROM public.import_rows WHERE job_id=_job;
  SELECT row_count INTO esperadas FROM public.import_files WHERE id = j.file_id;
  IF coalesce(esperadas,0) > 0 AND recebidas <> esperadas THEN
    RAISE EXCEPTION 'Recebemos % linhas de % esperadas. Reenvie o restante antes de validar.', recebidas, esperadas;
  END IF;
  IF j.status = 'recebendo' THEN
    UPDATE public.import_jobs SET status='recebido', sealed_at=now(), total_rows=recebidas WHERE id=_job;
  END IF;
  RETURN jsonb_build_object('linhas', recebidas);
END $$;
REVOKE ALL ON FUNCTION public.import_job_seal(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_seal(uuid) TO authenticated;

-- ---------- 4. validação ----------
CREATE OR REPLACE FUNCTION public.import_job_validate(_job uuid, _limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; r record; m jsonb; d jsonb; p jsonb; msgs jsonb; st text;
        c_sku text; c_leg text; c_ean text; c_nome text; q_raw text; q_num numeric;
        v_sku uuid; v_leg uuid; v_ean uuid; alvos uuid[];
        pode_custo boolean; custo int; preco int; feitas int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
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
      st := 'erro'; msgs := msgs || jsonb_build_object('campo','custo','valor',q_raw,
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
        'aviso','Endereço de imagem recebido, mas a importação de imagens ainda não está liberada: a imagem NÃO foi importada.');
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
      ok_rows    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('valido','processado')),
      warn_rows  = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='aviso'),
      error_rows = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status IN ('erro','conflito')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.import_rows WHERE job_id=_job AND status='pendente')
                    THEN 'validando' ELSE 'pronto' END
    WHERE j2.id = _job AND j2.status = 'validando';

  RETURN jsonb_build_object('validadas', feitas,
    'restantes', (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND status='pendente'),
    'indicadores', public.import_job_counters(_job));
END $$;

-- ---------- 5. processamento com reserva de linha ----------
CREATE OR REPLACE FUNCTION public.import_job_process(_job uuid, _limit integer DEFAULT 200, _worker uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; r record; p jsonb; w uuid := coalesce(_worker, gen_random_uuid());
        v_id uuid; prod_id uuid; cat_id uuid; col_id uuid; forn_id uuid; placeholder uuid;
        qtd int; mov uuid; ef jsonb; pubres jsonb; pubst text; msgs jsonb;
        feitas int := 0; erradas int := 0; restantes int; com_erro int; nome text; base_slug text;
        criou_cat boolean; criou_col boolean; criou_forn boolean; novo_produto boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id = _job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
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
  IF j.dry_run THEN
    UPDATE public.import_jobs SET status='simulando' WHERE id=_job AND status IN ('pronto','validando');
  ELSE
    UPDATE public.import_jobs SET status='processando', started_at=coalesce(started_at, now())
     WHERE id=_job AND status IN ('pronto','simulado','pausado','falhou');
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job;

  -- reserva as linhas (dois processadores nunca pegam a mesma)
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

      IF j.dry_run THEN
        ef := jsonb_build_object(
          'produto', CASE WHEN v_id IS NOT NULL THEN 'atualizado'
                          WHEN p->>'codigo_legado' IS NOT NULL AND EXISTS (
                             SELECT 1 FROM public.products WHERE upper(legacy_code)=upper(p->>'codigo_legado'))
                          THEN 'atualizado' ELSE 'criado' END,
          'variante', CASE WHEN v_id IS NOT NULL THEN 'atualizada' ELSE 'criada' END,
          'categoria_criada', (p->>'categoria') IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.categories WHERE public.norm_name(name)=public.norm_name(p->>'categoria')),
          'colecao_criada', (p->>'colecao') IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.collections WHERE public.norm_name(name)=public.norm_name(p->>'colecao')),
          'fornecedor_criado', (p->>'fornecedor') IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.suppliers WHERE public.norm_name(name)=public.norm_name(p->>'fornecedor')),
          'custo', (p->>'custo_cents') IS NOT NULL,
          'unidades', CASE WHEN j.mode='entrada' THEN qtd ELSE 0 END,
          'simulado', true);
        UPDATE public.import_rows
           SET status='simulado', processed_at=now(), effects=ef, claimed_by=NULL, claim_until=NULL,
               publish_status = CASE WHEN (p->>'publicar')::boolean THEN 'prevista' END,
               messages = msgs || jsonb_build_array(jsonb_build_object('aviso','Simulação: nada foi gravado.'))
         WHERE id = r.id;
        feitas := feitas + 1;
        CONTINUE;
      END IF;

      -- categoria / coleção / fornecedor, sem duplicar por acento ou caixa
      cat_id := NULL; col_id := NULL; forn_id := NULL;
      IF p->>'categoria' IS NOT NULL THEN
        SELECT id INTO cat_id FROM public.categories
          WHERE public.norm_name(name)=public.norm_name(p->>'categoria') LIMIT 1;
        IF cat_id IS NULL THEN
          INSERT INTO public.categories (name, slug, status)
          VALUES (p->>'categoria',
                  lower(regexp_replace(public.norm_name(p->>'categoria'),'[^a-z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                  'rascunho')
          ON CONFLICT (public.norm_name(name)) WHERE parent_id IS NULL DO NOTHING
          RETURNING id INTO cat_id;
          IF cat_id IS NULL THEN
            SELECT id INTO cat_id FROM public.categories
              WHERE public.norm_name(name)=public.norm_name(p->>'categoria') LIMIT 1;
          ELSE criou_cat := true; END IF;
        END IF;
      END IF;
      IF p->>'colecao' IS NOT NULL THEN
        SELECT id INTO col_id FROM public.collections
          WHERE public.norm_name(name)=public.norm_name(p->>'colecao') LIMIT 1;
        IF col_id IS NULL THEN
          INSERT INTO public.collections (name, slug, status)
          VALUES (p->>'colecao',
                  lower(regexp_replace(public.norm_name(p->>'colecao'),'[^a-z0-9]+','-','g'))||'-'||substr(gen_random_uuid()::text,1,6),
                  'rascunho')
          ON CONFLICT (public.norm_name(name)) DO NOTHING
          RETURNING id INTO col_id;
          IF col_id IS NULL THEN
            SELECT id INTO col_id FROM public.collections
              WHERE public.norm_name(name)=public.norm_name(p->>'colecao') LIMIT 1;
          ELSE criou_col := true; END IF;
        END IF;
      END IF;
      IF p->>'fornecedor' IS NOT NULL THEN
        SELECT id INTO forn_id FROM public.suppliers
          WHERE public.norm_name(name)=public.norm_name(p->>'fornecedor') LIMIT 1;
        IF forn_id IS NULL THEN
          INSERT INTO public.suppliers (name) VALUES (p->>'fornecedor')
          ON CONFLICT (public.norm_name(name)) DO NOTHING
          RETURNING id INTO forn_id;
          IF forn_id IS NULL THEN
            SELECT id INTO forn_id FROM public.suppliers
              WHERE public.norm_name(name)=public.norm_name(p->>'fornecedor') LIMIT 1;
          ELSE criou_forn := true; END IF;
        END IF;
      END IF;

      IF v_id IS NOT NULL THEN
        SELECT product_id INTO prod_id FROM public.product_variants WHERE id = v_id;
        UPDATE public.product_variants SET
          sku = coalesce(p->>'sku', sku), barcode = coalesce(p->>'ean', barcode),
          legacy_code = coalesce(p->>'codigo_legado', legacy_code),
          size = coalesce(p->>'tamanho', size), color = coalesce(p->>'cor', color),
          price_cents = coalesce((p->>'preco_cents')::int, price_cents), updated_at = now()
        WHERE id = v_id;
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
        ef := jsonb_build_object('produto','atualizado','variante','atualizada');
      ELSE
        IF p->>'codigo_legado' IS NOT NULL THEN
          SELECT id INTO prod_id FROM public.products
           WHERE upper(legacy_code) = upper(p->>'codigo_legado') LIMIT 1;
        END IF;
        IF prod_id IS NULL THEN
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
          novo_produto := true;
        END IF;

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
          v_id := placeholder;
          ef := jsonb_build_object('produto', CASE WHEN novo_produto THEN 'criado' ELSE 'atualizado' END,
                                   'variante','atualizada');
        ELSE
          INSERT INTO public.product_variants (
            product_id, label, sku, barcode, legacy_code, size, color, price_cents, position, is_active
          ) VALUES (
            prod_id,
            coalesce(nullif(trim(coalesce(p->>'tamanho','')||' '||coalesce(p->>'cor','')),''),'Único')
              ||' '||substr(md5(coalesce(p->>'sku', p->>'ean', p->>'codigo_legado','')),1,4),
            p->>'sku', p->>'ean', p->>'codigo_legado', p->>'tamanho', p->>'cor',
            (p->>'preco_cents')::int,
            (SELECT coalesce(max(position),0)+1 FROM public.product_variants WHERE product_id = prod_id),
            true
          ) RETURNING id INTO v_id;
          ef := jsonb_build_object('produto', CASE WHEN novo_produto THEN 'criado' ELSE 'atualizado' END,
                                   'variante','criada');
        END IF;
      END IF;

      IF (p->>'custo_cents') IS NOT NULL THEN
        INSERT INTO public.variant_costs (variant_id, supplier_id, cost_cents, note)
        VALUES (v_id, forn_id, (p->>'custo_cents')::int, 'Importação '||j.job_key);
      END IF;

      IF j.mode = 'entrada' AND qtd > 0 THEN
        mov := public.register_stock_movement(
          'entrada'::stock_move_kind, v_id, qtd, NULL, j.location_id,
          j.reason_code, (p->>'custo_cents')::int,
          coalesce(j.reference, j.job_key), 'Importação em massa '||j.job_key,
          j.id::text||':'||r.line_no||':entrada');
      END IF;

      -- publicação exclusivamente pela operação canônica
      IF coalesce((p->>'publicar')::boolean,false) THEN
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

      ef := ef || jsonb_build_object(
        'categoria_criada', criou_cat, 'colecao_criada', criou_col,
        'fornecedor_criado', criou_forn, 'custo', (p->>'custo_cents') IS NOT NULL,
        'unidades', CASE WHEN mov IS NOT NULL THEN qtd ELSE 0 END);

      UPDATE public.import_rows
         SET status='processado', processed_at=now(), product_id=prod_id, variant_id=v_id,
             movement_id=mov, attempts = attempts + 1, effects = ef, publish_status = pubst,
             messages = msgs, claimed_by=NULL, claim_until=NULL
       WHERE id = r.id;
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
      products_updated = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'produto'='atualizado'),
      variants_created = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'variante'='criada'),
      variants_updated = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND effects->>'variante'='atualizada'),
      stock_entries    = (SELECT count(*) FROM public.import_rows WHERE job_id=_job AND movement_id IS NOT NULL),
      units_in         = (SELECT coalesce(sum(coalesce((effects->>'unidades')::int,0)),0) FROM public.import_rows WHERE job_id=_job),
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
END $$;

-- ---------- 6. pausar / retomar / cancelar / promover ----------
CREATE OR REPLACE FUNCTION public.import_job_pause(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.status = 'pausado' THEN RETURN jsonb_build_object('status','pausado'); END IF;
  IF j.status <> 'processando' THEN RAISE EXCEPTION 'Só é possível pausar um lote em processamento.'; END IF;
  IF EXISTS (SELECT 1 FROM public.import_rows WHERE job_id=_job AND status='processando'
               AND coalesce(claim_until, now()) > now()) THEN
    UPDATE public.import_jobs SET status='pausando' WHERE id=_job;
  ELSE
    UPDATE public.import_jobs SET status='pausando' WHERE id=_job;
    UPDATE public.import_jobs SET status='pausado', paused_at=now() WHERE id=_job;
  END IF;
  PERFORM public.import_audit('importacao.pausar', _job, jsonb_build_object(
    'checkpoint', j.checkpoint_line));
  RETURN jsonb_build_object('status', (SELECT status FROM public.import_jobs WHERE id=_job),
    'indicadores', public.import_job_counters(_job));
END $$;
REVOKE ALL ON FUNCTION public.import_job_pause(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_pause(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_job_resume(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.import_jobs; soltas int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO j FROM public.import_jobs WHERE id=_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote inexistente.'; END IF;
  IF j.status NOT IN ('pausado','pausando','falhou') THEN
    RAISE EXCEPTION 'Só é possível retomar um lote pausado ou com falha.';
  END IF;
  UPDATE public.import_rows
     SET status = CASE WHEN coalesce(parsed->>'variant_id','') = '' AND messages @> '[{"aviso":""}]'::jsonb
                       THEN 'valido' ELSE coalesce(nullif(status,'processando'),'valido') END,
         claimed_by=NULL, claim_until=NULL
   WHERE job_id=_job AND status='processando';
  GET DIAGNOSTICS soltas = ROW_COUNT;
  UPDATE public.import_jobs SET status='processando', paused_at=NULL WHERE id=_job;
  PERFORM public.import_audit('importacao.retomar', _job, jsonb_build_object(
    'checkpoint', j.checkpoint_line, 'linhas_liberadas', soltas));
  RETURN jsonb_build_object('status','processando','linhas_liberadas', soltas,
    'indicadores', public.import_job_counters(_job));
END $$;
REVOKE ALL ON FUNCTION public.import_job_resume(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_resume(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_job_cancel(_job uuid, _motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF j.status IN ('cancelado','concluido','concluido_com_erros') THEN
    RAISE EXCEPTION 'Lote já encerrado (%).', j.status;
  END IF;
  aplicado := public.import_job_counters(_job);
  UPDATE public.import_rows SET status='ignorado', claimed_by=NULL, claim_until=NULL
   WHERE job_id=_job AND status IN ('pendente','valido','aviso','processando');
  UPDATE public.import_jobs SET status='cancelado', cancel_reason=_motivo, finished_at=now() WHERE id=_job;
  PERFORM public.import_audit('importacao.cancelar', _job,
    jsonb_build_object('motivo', _motivo, 'ja_aplicado', aplicado));
  RETURN jsonb_build_object('status','cancelado','ja_aplicado', aplicado);
END $$;
REVOKE ALL ON FUNCTION public.import_job_cancel(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_cancel(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_job_promote(_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.import_jobs; novo jsonb; nid uuid; obsoleta boolean; fp text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'imports.run') THEN
    RAISE EXCEPTION 'Sem permissão para importar.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.import_jobs WHERE id=_job;
  IF NOT FOUND OR NOT s.dry_run THEN RAISE EXCEPTION 'Simulação inexistente.'; END IF;
  IF s.status <> 'simulado' THEN RAISE EXCEPTION 'Conclua a simulação antes de executar de verdade.'; END IF;

  SELECT md5(count(*)::text || coalesce(max(updated_at)::text,'')) INTO fp FROM public.products;
  obsoleta := fp IS DISTINCT FROM s.base_fingerprint;

  novo := public.import_job_open2(s.file_id, s.mode, s.mapping, s.defaults, false,
            s.location_id, s.operation_date, s.reason_code, s.reference,
            s.template_id, s.template_version, s.id, s.correction_of);
  nid := (novo->>'id')::uuid;

  INSERT INTO public.import_rows (job_id, line_no, raw)
  SELECT nid, line_no, raw FROM public.import_rows WHERE job_id=_job
  ON CONFLICT (job_id, line_no) DO NOTHING;
  UPDATE public.import_jobs SET total_rows=(SELECT count(*) FROM public.import_rows WHERE job_id=nid)
   WHERE id=nid;

  PERFORM public.import_audit('importacao.promover', nid,
    jsonb_build_object('simulacao', _job, 'base_mudou', obsoleta));
  RETURN novo || jsonb_build_object('base_mudou', obsoleta);
END $$;
REVOKE ALL ON FUNCTION public.import_job_promote(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_promote(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.import_job_process(uuid,integer,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_process(uuid,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.import_job_validate(uuid,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_validate(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.import_rows_stage(uuid,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_rows_stage(uuid,jsonb) TO authenticated;
DROP FUNCTION IF EXISTS public.import_job_process(uuid,integer);
DROP FUNCTION IF EXISTS public.import_job_cancel(uuid);
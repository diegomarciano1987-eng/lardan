-- 1) identidade de entrada do lote -------------------------------------------
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS entry_key text;

UPDATE public.import_jobs j
   SET entry_key = md5(coalesce(f.sha256,'') || ':' || j.mode || ':' ||
        coalesce(j.location_id::text,'') || ':' || coalesce(j.operation_date::text,'') || ':' ||
        coalesce(j.reference,''))
  FROM public.import_files f
 WHERE f.id = j.file_id AND j.entry_key IS NULL;

CREATE OR REPLACE FUNCTION public.import_entry_key(_file uuid, _mode text, _location uuid, _data date, _ref text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT md5(coalesce((SELECT sha256 FROM public.import_files WHERE id = _file),'') || ':' ||
             coalesce(_mode,'catalogo') || ':' || coalesce(_location::text,'') || ':' ||
             coalesce(_data::text,'') || ':' || coalesce(_ref,''))
$$;

-- 2) abertura do lote grava a identidade de entrada ---------------------------
CREATE OR REPLACE FUNCTION public.import_job_open2(_file uuid, _mode text, _mapping jsonb, _defaults jsonb, _dry_run boolean, _location_id uuid DEFAULT NULL::uuid, _operation_date date DEFAULT NULL::date, _reason_code text DEFAULT NULL::text, _reference text DEFAULT NULL::text, _template_id uuid DEFAULT NULL::uuid, _template_version integer DEFAULT NULL::integer, _simulation_of uuid DEFAULT NULL::uuid, _correction_of uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f public.import_files; j public.import_jobs; chave text; n int := 0;
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
     AND responsible_user_id = auth.uid()
     AND status NOT IN ('concluido','concluido_com_erros','cancelado')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('id', j.id, 'reaproveitado', true, 'status', j.status,
      'linhas', j.total_rows, 'chave', j.job_key, 'entrada', j.entry_key);
  END IF;

  SELECT count(*) INTO n FROM public.import_jobs WHERE job_key LIKE chave || '%';
  IF n > 0 THEN chave := chave || '#' || (n+1)::text; END IF;

  INSERT INTO public.import_jobs (
    job_key, file_id, file_name, file_size, mode, mapping, defaults, dry_run,
    location_id, operation_date, reason_code, reference, responsible_user_id,
    template_id, template_version, simulation_of, correction_of,
    base_fingerprint, entry_key, status
  ) VALUES (
    chave, f.id, f.file_name, least(f.byte_size, 2147483647)::int, coalesce(_mode,'catalogo'),
    coalesce(_mapping,'{}'::jsonb), coalesce(_defaults,'{}'::jsonb), coalesce(_dry_run,false),
    _location_id, _operation_date, _reason_code, nullif(trim(coalesce(_reference,'')),''), auth.uid(),
    _template_id, _template_version, _simulation_of, _correction_of,
    (SELECT md5(count(*)::text || coalesce(max(updated_at)::text,'')) FROM public.products),
    public.import_entry_key(f.id, coalesce(_mode,'catalogo'), _location_id, _operation_date,
                            nullif(trim(coalesce(_reference,'')),'')),
    'recebendo'
  ) RETURNING * INTO j;

  PERFORM public.import_audit('importacao.abrir', j.id, jsonb_build_object(
    'arquivo', f.sha256, 'modo', j.mode, 'simulacao', j.dry_run, 'chave', j.job_key,
    'entrada', j.entry_key));
  RETURN jsonb_build_object('id', j.id, 'reaproveitado', false, 'status', j.status,
    'linhas', 0, 'chave', j.job_key, 'entrada', j.entry_key);
END $function$;

-- 3) contadores com semântica fechada ----------------------------------------
CREATE OR REPLACE FUNCTION public.import_job_counters(_job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE res jsonb; linhas jsonb; prod jsonb; vari jsonb; outros jsonb; recebidas int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_jobs WHERE id=_job
                  AND (responsible_user_id = auth.uid() OR public.has_role(auth.uid(),'master')
                       OR public.has_role(auth.uid(),'diretoria'))) THEN
    RAISE EXCEPTION 'Lote fora do seu escopo.' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO recebidas FROM public.import_rows WHERE job_id=_job;

  SELECT jsonb_build_object(
    'recebidas',    count(*),
    'vazias',       count(*) FILTER (WHERE status='ignorado' AND error_code='linha_vazia'),
    'canceladas',   count(*) FILTER (WHERE status='ignorado' AND error_code IS DISTINCT FROM 'linha_vazia'),
    'pendentes',    count(*) FILTER (WHERE status IN ('pendente','processando')),
    'validas',      count(*) FILTER (WHERE status IN ('valido','aviso')),
    'recusadas',    count(*) FILTER (WHERE status IN ('erro','conflito')),
    'processadas',  count(*) FILTER (WHERE status='processado'),
    'simuladas',    count(*) FILTER (WHERE status='simulado'),
    'reprocessadas',count(*) FILTER (WHERE attempts > 1),
    'com_aviso',    count(*) FILTER (WHERE jsonb_array_length(coalesce(messages,'[]'::jsonb)) > 0)
  ) INTO linhas FROM public.import_rows WHERE job_id=_job;

  SELECT jsonb_build_object(
    'criados',       count(DISTINCT coalesce(product_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'produto'='criado'),
    'alterados',     count(DISTINCT coalesce(product_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'produto'='alterado'),
    'sem_alteracao', count(DISTINCT coalesce(product_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'produto'='sem_alteracao'),
    'encontrados',   count(DISTINCT product_id) FILTER (WHERE effects->>'produto' IN ('alterado','sem_alteracao')),
    'recusados',     count(*) FILTER (WHERE status IN ('erro','conflito')),
    'duplicados',    count(*) FILTER (WHERE (effects->>'duplicada')::boolean)
  ) INTO prod FROM public.import_rows WHERE job_id=_job;

  SELECT jsonb_build_object(
    'criadas',       count(DISTINCT coalesce(variant_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'variante'='criada'),
    'alteradas',     count(DISTINCT coalesce(variant_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'variante'='alterada'),
    'sem_alteracao', count(DISTINCT coalesce(variant_id::text, effects->>'chave'))
                       FILTER (WHERE effects->>'variante'='sem_alteracao'),
    'encontradas',   count(DISTINCT variant_id) FILTER (WHERE effects->>'variante' IN ('alterada','sem_alteracao')),
    'recusadas',     count(*) FILTER (WHERE status IN ('erro','conflito')),
    'duplicadas',    count(*) FILTER (WHERE (effects->>'duplicada')::boolean)
  ) INTO vari FROM public.import_rows WHERE job_id=_job;

  SELECT jsonb_build_object(
    'categorias_criadas',   count(DISTINCT effects->>'categoria_nome') FILTER (WHERE (effects->>'categoria_criada')::boolean),
    'colecoes_criadas',     count(DISTINCT effects->>'colecao_nome')   FILTER (WHERE (effects->>'colecao_criada')::boolean),
    'fornecedores_criados', count(DISTINCT effects->>'fornecedor_nome')FILTER (WHERE (effects->>'fornecedor_criado')::boolean),
    'custos_inseridos',     count(*) FILTER (WHERE effects->>'custo'='inserido'),
    'custos_sem_alteracao', count(*) FILTER (WHERE effects->>'custo'='sem_alteracao'),
    'movimentacoes_criadas',count(*) FILTER (WHERE movement_id IS NOT NULL AND effects->>'estoque'='criada'),
    'movimentacoes_reaproveitadas', count(*) FILTER (WHERE effects->>'estoque'='ja_lancada'),
    'unidades',             coalesce(sum(coalesce((effects->>'unidades')::int,0)) FILTER (WHERE effects->>'estoque'='criada'),0),
    'publicacoes_solicitadas', count(*) FILTER (WHERE publish_status IS NOT NULL),
    'publicacoes_concluidas',  count(*) FILTER (WHERE publish_status='publicado'),
    'publicacoes_ja_publicadas', count(*) FILTER (WHERE publish_status='ja_publicado'),
    'publicacoes_recusadas',   count(*) FILTER (WHERE publish_status='recusada')
  ) INTO outros FROM public.import_rows WHERE job_id=_job;

  res := jsonb_build_object('linhas', linhas, 'produtos', prod, 'variacoes', vari, 'efeitos', outros);
  res := res || jsonb_build_object('fecha',
    (coalesce((linhas->>'vazias')::int,0) + coalesce((linhas->>'canceladas')::int,0)
     + coalesce((linhas->>'pendentes')::int,0) + coalesce((linhas->>'validas')::int,0)
     + coalesce((linhas->>'recusadas')::int,0) + coalesce((linhas->>'processadas')::int,0)
     + coalesce((linhas->>'simuladas')::int,0)) = coalesce(recebidas,0));
  RETURN coalesce(res,'{}'::jsonb);
END $function$;
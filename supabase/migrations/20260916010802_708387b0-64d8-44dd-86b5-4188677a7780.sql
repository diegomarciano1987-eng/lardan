-- somente Master executa importação de produto nesta fase
CREATE OR REPLACE FUNCTION public.import_pode_produto(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL
     AND public.has_capability(_uid,'imports.run')
     AND public.has_capability(_uid,'product.manage');
$$;
REVOKE ALL ON FUNCTION public.import_pode_produto(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_pode_produto(uuid) TO authenticated, service_role;

DO $do$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT oid FROM pg_proc
            WHERE pronamespace='public'::regnamespace
              AND proname IN ('import_job_open2','import_rows_stage','import_job_seal',
                              'import_job_validate','import_job_process','import_job_pause',
                              'import_job_resume','import_job_cancel','import_job_promote')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF position('has_capability(auth.uid(),''imports.run'')' IN d) > 0 THEN
      d := replace(d, 'public.has_capability(auth.uid(),''imports.run'')',
                      'public.import_pode_produto(auth.uid())');
      EXECUTE d;
    END IF;
  END LOOP;
END $do$;

-- conferência: contagens exigidas na prévia
CREATE OR REPLACE FUNCTION public.import_job_preview(_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE res jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_jobs WHERE id=_job
                  AND (responsible_user_id = auth.uid() OR public.has_role(auth.uid(),'master')
                       OR public.has_role(auth.uid(),'diretoria'))) THEN
    RAISE EXCEPTION 'Lote fora do seu escopo.' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'formato', coalesce(max(parsed->>'formato'), 'legado'),
    'banhos_nao_reconhecidos', count(*) FILTER (WHERE messages @> '[{"campo":"banho"}]'::jsonb AND status='erro'),
    'subcategorias_invalidas', count(*) FILTER (WHERE messages @> '[{"campo":"subcategoria"}]'::jsonb AND status='erro'),
    'categorias_invalidas',    count(*) FILTER (WHERE messages @> '[{"campo":"categoria"}]'::jsonb AND status='erro'),
    'fornecedores_nao_encontrados',
      count(*) FILTER (WHERE messages @> '[{"campo":"fornecedor"}]'::jsonb
                          OR messages @> '[{"campo":"fornecedor_banho"}]'::jsonb),
    'barcodes_duplicados', count(*) FILTER (WHERE error_code IN ('ean','barcode_duplicado')),
    'skus_duplicados',     count(*) FILTER (WHERE error_code IN ('sku','sku_duplicado')),
    'duplicadas_no_arquivo', count(*) FILTER (WHERE error_code = 'duplicada_no_arquivo'),
    'valores_invalidos',
      count(*) FILTER (WHERE status='erro' AND (messages @> '[{"campo":"valor_bruto"}]'::jsonb
        OR messages @> '[{"campo":"valor_banho"}]'::jsonb OR messages @> '[{"campo":"valor_verniz"}]'::jsonb
        OR messages @> '[{"campo":"valor_final"}]'::jsonb OR messages @> '[{"campo":"preco"}]'::jsonb
        OR messages @> '[{"campo":"quantidade"}]'::jsonb)),
    'custos_novos',        count(*) FILTER (WHERE effects->>'custo' = 'inserido'),
    'sem_alteracao',       count(*) FILTER (WHERE effects->>'produto'='sem_alteracao'
                                              AND effects->>'variante'='sem_alteracao'),
    'publicacoes_solicitadas', count(*) FILTER (WHERE coalesce((parsed->>'publicar')::boolean,false)),
    'publicacoes_bloqueadas',  count(*) FILTER (WHERE publish_status = 'recusada'),
    'recusadas',           count(*) FILTER (WHERE status IN ('erro','conflito')),
    'avisos',              count(*) FILTER (WHERE status = 'aviso'),
    'unidades_previstas',  coalesce(sum(coalesce((parsed->>'quantidade')::int,0))
                             FILTER (WHERE status IN ('valido','aviso','simulado','processado')),0)
  ) INTO res FROM public.import_rows WHERE job_id = _job;

  RETURN coalesce(res,'{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.import_job_preview(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_job_preview(uuid) TO authenticated, service_role;

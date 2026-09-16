DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.import_job_process(uuid,integer,uuid)'::regprocedure);
  d := replace(d,
$old$        IF sku_novo IS NOT NULL AND EXISTS
           (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
          sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
        END IF;$old$,
$new$        IF sku_novo IS NOT NULL AND EXISTS
           (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
          IF p->>'sku' IS NOT NULL THEN
            RAISE EXCEPTION 'SKU % ja pertence a outra variante.', sku_novo USING ERRCODE='23505';
          END IF;
          sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
        END IF;$new$);
  d := replace(d,
$old$          IF sku_novo IS NOT NULL AND EXISTS
             (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
            sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
          END IF;$old$,
$new$          IF sku_novo IS NOT NULL AND EXISTS
             (SELECT 1 FROM public.product_variants WHERE upper(sku)=upper(sku_novo)) THEN
            IF p->>'sku' IS NOT NULL THEN
              RAISE EXCEPTION 'SKU % ja pertence a outra variante.', sku_novo USING ERRCODE='23505';
            END IF;
            sku_novo := sku_novo || '-' || substr(md5(gen_random_uuid()::text),1,4);
          END IF;$new$);
  EXECUTE d;
END $do$;

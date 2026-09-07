CREATE OR REPLACE FUNCTION public.import_row_dup_in_file(_job uuid, _row uuid, _line integer, _sku text, _ean text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.import_rows x
     WHERE x.job_id = _job AND x.id <> _row AND x.line_no < _line
       AND x.status IN ('processado','simulado')
       AND ( (nullif(trim(coalesce(_sku,'')),'') IS NOT NULL
              AND upper(x.parsed->>'sku') = upper(_sku))
          OR (nullif(trim(coalesce(_ean,'')),'') IS NOT NULL
              AND upper(x.parsed->>'ean') = upper(_ean)) ));
$$;
REVOKE ALL ON FUNCTION public.import_row_dup_in_file(uuid,uuid,integer,text,text) FROM PUBLIC, anon;

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
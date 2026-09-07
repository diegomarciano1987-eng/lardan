CREATE INDEX IF NOT EXISTS import_rows_job_line_idx
  ON public.import_rows (job_id, line_no);

CREATE INDEX IF NOT EXISTS import_rows_job_sku_idx
  ON public.import_rows (job_id, (upper(parsed->>'sku')), line_no)
  WHERE parsed IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_rows_job_ean_idx
  ON public.import_rows (job_id, (upper(parsed->>'ean')), line_no)
  WHERE parsed IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_rows_job_chave_idx
  ON public.import_rows (
    job_id,
    (upper(coalesce(parsed->>'codigo_legado', parsed->>'sku', parsed->>'ean', parsed->>'nome'))),
    line_no)
  WHERE parsed IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_rows_job_status_idx
  ON public.import_rows (job_id, status, line_no);
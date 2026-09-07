CREATE OR REPLACE FUNCTION public.import_job_process_guard_note() RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;

DO $mig$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='import_job_process'
    AND pg_get_function_identity_arguments(p.oid)='_job uuid, _limit integer, _worker uuid';
  IF src IS NULL THEN RAISE EXCEPTION 'import_job_process nao encontrada'; END IF;

  src := replace(src,
$old$  IF j.status IN ('cancelado','concluido','concluido_com_erros') THEN
    RAISE EXCEPTION 'Lote encerrado (%).', j.status;
  END IF;$old$,
$new$  IF j.status IN ('concluido','concluido_com_erros') THEN
    RETURN jsonb_build_object('processadas', 0, 'restantes', 0, 'encerrado', true,
      'status', j.status, 'indicadores', public.import_job_counters(_job));
  END IF;
  IF j.status = 'cancelado' THEN
    RAISE EXCEPTION 'Lote cancelado (%).', coalesce(j.cancel_reason,'sem motivo');
  END IF;$new$);

  EXECUTE src;
END
$mig$;

DROP FUNCTION IF EXISTS public.import_job_process_guard_note();
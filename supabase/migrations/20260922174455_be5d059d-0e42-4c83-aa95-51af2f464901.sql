DO $mig$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'register_stock_movement';
  IF src IS NULL THEN RAISE EXCEPTION 'register_stock_movement não encontrada'; END IF;

  novo := regexp_replace(
    src,
    '(SELECT id INTO mov FROM public\.stock_movements WHERE idempotency_key = _idempotency_key;)',
    'PERFORM pg_advisory_xact_lock(hashtextextended(''stockmov:'' || _idempotency_key, 0)); \1'
  );
  IF novo = src THEN RAISE EXCEPTION 'trecho de idempotência não localizado'; END IF;
  EXECUTE novo;
END $mig$;
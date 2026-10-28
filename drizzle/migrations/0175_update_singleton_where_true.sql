DO $mig$
DECLARE f record; d text; novo text;
BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
      AND p.proname IN ('access_mfa_exigir','lider_config_salvar','party_codigos_smalldata_adotar','pedido_config_salvar','pre_baixa_exigir_definir','preco_reajuste_aplicar')
  LOOP
    d := pg_get_functiondef(f.oid);
    novo := regexp_replace(d, '(UPDATE\s+[a-z_\.]+(?:\s+[a-z]+)?\s+SET\s+(?:(?!WHERE)[^;])*?)(\s*);', '\1 WHERE true;', 'gi');
    IF novo IS DISTINCT FROM d THEN EXECUTE novo; END IF;
  END LOOP;
END $mig$;
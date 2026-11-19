-- 0348: telas de nota fiscal mostram "[Cód. X] Nome" da consultora (regra: código sempre junto do nome).
-- Só muda o texto de leitura 'consultora'; permissões e dados fiscais não mudam.
DO $mig$
DECLARE f text; def text; novo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fiscal_producao_estado','fiscal_focus_envios_lista','fiscal_recusas_incertas_pendentes'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF def IS NULL THEN RAISE EXCEPTION '0348: função % não encontrada', f; END IF;
    novo := replace(def, $a$'consultora', p.display_name$a$,
                         $a$'consultora', nullif(concat_ws(' ', '[Cód. ' || nullif(btrim(p.code), '') || ']', p.display_name), '')$a$);
    IF novo = def THEN RAISE EXCEPTION '0348: % diferente do esperado', f; END IF;
    EXECUTE novo;
  END LOOP;
END $mig$;
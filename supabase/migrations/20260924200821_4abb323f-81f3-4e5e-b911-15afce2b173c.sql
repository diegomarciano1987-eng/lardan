DO $migration$
DECLARE
  original_definition text;
  updated_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO original_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'submit_candidatura'
     AND pg_get_function_identity_arguments(p.oid) = '_payload jsonb, _tracking jsonb';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'submit_candidatura_nao_encontrada';
  END IF;

  updated_definition := replace(
    original_definition,
    'WHERE cpf_digits = v_cpf OR whatsapp_norm = v_wa OR (v_email IS NOT NULL AND email_norm = v_email)',
    'WHERE cpf_digits = v_cpf OR (cpf_digits IS NULL AND (whatsapp_norm = v_wa OR (v_email IS NOT NULL AND email_norm = v_email)))'
  );

  IF updated_definition = original_definition THEN
    RAISE EXCEPTION 'regra_de_duplicidade_nao_encontrada';
  END IF;

  EXECUTE updated_definition;
END
$migration$;
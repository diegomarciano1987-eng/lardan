-- 0349: trocas fiscais automáticas mostram "[Cód. X] Nome" das consultoras (anterior e nova). Só leitura.
DO $mig$
DECLARE def text; novo text;
BEGIN
  SELECT pg_get_functiondef('public.fiscal_trocas_lista()'::regprocedure) INTO def;
  novo := replace(def, $a$'anterior', p.consultora_anterior_nome, 'nova', p.consultora_nova_nome,$a$,
    $a$'anterior', nullif(concat_ws(' ', '[Cód. ' || nullif(btrim((SELECT x.code FROM parties x WHERE x.id = p.consultora_anterior_party_id)), '') || ']', p.consultora_anterior_nome), ''),
             'nova', nullif(concat_ws(' ', '[Cód. ' || nullif(btrim((SELECT x.code FROM parties x WHERE x.id = p.consultora_nova_party_id)), '') || ']', p.consultora_nova_nome), ''),$a$);
  IF novo = def THEN RAISE EXCEPTION '0349: fiscal_trocas_lista diferente do esperado'; END IF;
  EXECUTE novo;
END $mig$;
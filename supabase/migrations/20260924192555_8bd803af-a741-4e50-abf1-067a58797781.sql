
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS dream text,
  ADD COLUMN IF NOT EXISTS dream_value_cents bigint CHECK (dream_value_cents IS NULL OR dream_value_cents >= 0);

DO $mig$
DECLARE f text; n text;
BEGIN
  f := pg_get_functiondef('public.submit_candidatura'::regproc);
  n := replace(f,
    $a$motivation     = coalesce(nullif(btrim(_payload->>'motivation'),''), motivation),$a$,
    $a$motivation     = coalesce(nullif(btrim(_payload->>'motivation'),''), motivation),
      dream          = coalesce(nullif(left(btrim(_payload->>'dream'), 300),''), dream),
      dream_value_cents = coalesce(CASE WHEN coalesce(_payload->>'dream_value_cents','') ~ '^[0-9]{1,12}$' THEN (_payload->>'dream_value_cents')::bigint END, dream_value_cents),$a$);
  n := replace(n,
    $a$financial_goal, availability, experience, audience, motivation,$a$,
    $a$financial_goal, availability, experience, audience, motivation, dream, dream_value_cents,$a$);
  n := replace(n,
    $a$left(btrim(_payload->>'motivation'), 2000),$a$,
    $a$left(btrim(_payload->>'motivation'), 2000),
    nullif(left(btrim(coalesce(_payload->>'dream','')), 300), ''),
    CASE WHEN coalesce(_payload->>'dream_value_cents','') ~ '^[0-9]{1,12}$' THEN (_payload->>'dream_value_cents')::bigint END,$a$);
  IF (length(n) - length(f)) < 400 THEN RAISE EXCEPTION 'submit_candidatura: trechos não encontrados'; END IF;
  EXECUTE n;

  f := pg_get_functiondef('public.crm_detail'::regproc);
  n := replace(f, $a$'motivacao', v_l.motivation,$a$,
    $a$'motivacao', v_l.motivation, 'sonho', v_l.dream, 'sonho_valor_cents', v_l.dream_value_cents,$a$);
  IF n = f THEN RAISE EXCEPTION 'crm_detail: trecho não encontrado'; END IF;
  EXECUTE n;
END $mig$;

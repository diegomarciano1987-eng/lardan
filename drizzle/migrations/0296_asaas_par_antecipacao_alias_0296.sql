-- 0296: corrige 0295 — o apelido "g" da subconsulta colidia com a variável de laço "g" da rotina do extrato.
DO $patch$
DECLARE def text;
  ant1 text := $q$       AND EXISTS (SELECT 1 FROM public.financial_statement_lines g
                    WHERE g.financial_account_id = a.financial_account_id AND g.raw->>'type' = 'RECEIVABLE_ANTICIPATION_GROSS_CREDIT'
                      AND g.raw->>'anticipationId' = b.raw->>'anticipationId' AND g.status = 'conciliada' AND g.valor_cents = a.valor_cents)$q$;
  nov1 text := $q$       AND EXISTS (SELECT 1 FROM public.financial_statement_lines gc
                    WHERE gc.financial_account_id = a.financial_account_id AND gc.raw->>'type' = 'RECEIVABLE_ANTICIPATION_GROSS_CREDIT'
                      AND gc.raw->>'anticipationId' = b.raw->>'anticipationId' AND gc.status = 'conciliada' AND gc.valor_cents = a.valor_cents)$q$;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_nucleo(uuid,integer)'::regprocedure);
  IF position(ant1 IN def) = 0 THEN RAISE EXCEPTION '0296: trecho não encontrado em asaas_auto_extrato_nucleo'; END IF;
  EXECUTE replace(def, ant1, nov1);
END $patch$;
-- 0288: desempenho da etapa B do Asaas automático (a busca de tarifa varria todas as baixas por LIKE com curinga no começo)
CREATE INDEX IF NOT EXISTS financial_settlements_reversed_of_idx ON public.financial_settlements (reversed_of) WHERE reversed_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_reconciliations_settlement_idx ON public.financial_reconciliations (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_reconciliation_allocations_line_idx ON public.financial_reconciliation_allocations (line_id);
CREATE INDEX IF NOT EXISTS financial_reconciliation_allocations_rec_idx ON public.financial_reconciliation_allocations (reconciliation_id);

DO $patch$
DECLARE def text; novo text;
BEGIN
  def := pg_get_functiondef('public.asaas_auto_extrato_nucleo(uuid,integer)'::regprocedure);
  novo := replace(def,
$a$         AND NOT EXISTS (SELECT 1 FROM public.financial_settlements s WHERE s.idempotency_key LIKE 'asaas:baixa:%:' || (f.raw->>'paymentId')
                           AND NOT s.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id))$a$,
$b$         AND NOT EXISTS (SELECT 1 FROM public.asaas_accounts ac JOIN public.financial_settlements s
                            ON (s.idempotency_key = 'asaas:baixa:' || ac.id || ':' || (f.raw->>'paymentId')
                                OR (s.idempotency_key >= 'asaas:baixa:' || ac.id || ':r' AND s.idempotency_key < 'asaas:baixa:' || ac.id || ':s'
                                    AND s.idempotency_key LIKE '%:' || (f.raw->>'paymentId')))
                          WHERE ac.financial_account_id = f.financial_account_id
                            AND NOT s.is_reversal AND NOT EXISTS (SELECT 1 FROM public.financial_settlements x WHERE x.reversed_of = s.id))$b$);
  IF novo = def THEN
    RAISE EXCEPTION '0288: trecho da tarifa não encontrado em asaas_auto_extrato_nucleo';
  END IF;
  EXECUTE novo;
END $patch$;
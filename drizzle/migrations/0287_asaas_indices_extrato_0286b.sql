-- 0286b: buscas por pay_ no extrato e por baixa nos movimentos (rotina automática do Asaas e conciliação automática)
CREATE INDEX IF NOT EXISTS financial_statement_lines_payment_idx
  ON public.financial_statement_lines (financial_account_id, (raw->>'paymentId'))
  WHERE raw ? 'paymentId';
CREATE INDEX IF NOT EXISTS financial_account_movements_settlement_idx
  ON public.financial_account_movements (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_account_movements_transfer_idx
  ON public.financial_account_movements (transfer_id) WHERE transfer_id IS NOT NULL;
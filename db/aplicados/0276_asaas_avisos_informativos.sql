-- 0276 (pacote 0275 do Diego) — dados: avisos do Asaas só informativos (a cliente abriu a página/boleto)
-- saem da fila de revisão. Não mexem em cobrança, baixa nem cadastro. Idempotente.
-- Aplicado em 08/11/2026 pela ferramenta de dados (não é migração de estrutura).
UPDATE public.asaas_events
   SET status = 'ignorado', classification = 'conhecido', last_error = NULL, processed_at = coalesce(processed_at, now())
 WHERE processed_at IS NULL
   AND event IN ('PAYMENT_CHECKOUT_VIEWED', 'PAYMENT_BANK_SLIP_VIEWED', 'PAYMENT_VIEWED');

# Asaas

- Drain the Asaas webhook queue only through `drenarFilaAsaas` (fila.server.ts); the morning sync and the manual button both call it, matching charge by account + external id. It only picks events with `processed_at IS NULL` and stops at a time budget; processed events left `na_fila` await a human decision and are counted separately ("aguardando decisão"). Why: notices that arrive before the mirrored charge must not stay stuck, and re-running hundreds of already-processed events froze the button.

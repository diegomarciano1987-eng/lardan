# Asaas

- Drain the Asaas webhook queue only through `drenarFilaAsaas` (fila.server.ts); the morning sync and the manual button both call it, matching charge by account + external id. Why: notices that arrive before the mirrored charge must not stay stuck forever.

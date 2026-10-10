# Portal do representante

- Representative portal reads only via rep_portal_* RPCs gated by rep_portal_pode (own party as representante, or master/diretoria/financeiro/cobranca mirroring via /representante?rep=<party>); why: Daniel sees exactly the same numbers, scoped server-side.
- Representative actions (Asaas charge via repCobrar + rep_asaas_preparar, typed-value charge via rep_cobranca_avulsa, cheque, reactivation, CRM moves/new leads) are allowed to whoever passes rep_portal_pode for the carteira that owns the target (owner representante or mirroring back-office), audited with the real caller. Why: Daniel operates the representative's screen exactly as the representative does.

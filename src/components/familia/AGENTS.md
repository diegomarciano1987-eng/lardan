# Financeiro da família (0177)

- Personal household finance for consultants and representatives, ported from the old system's "Financeiro Família": tables familia_* owned by user_id = auth.uid() with FORCE RLS and owner-only policies (no has_role, no staff bypass, no audit_logs). Why: it is the person's private life; not even Master may read it.
- The module imports only @/components/ui, @/lib/utils, the Supabase client and its own @/lib/familia + @/components/familia files, and calls only familia_* tables/RPCs (tests/isolado/familia-independencia.test.ts). Why: zero coupling with maletas, cobrança, finance, alerts, push or e-mail.
- All numbers come from the pure engine src/lib/familia/motor.ts (competence basis; fixed expenses are rules, months computed on screen; only paid/skipped marks are stored). Why: cards, lists, charts and the annual report can never disagree.
- In the representative mirror (?rep=, Master/Daniel) the Família tab renders FamiliaTrancada and queries nothing. Why: the mirror would otherwise show the viewer's own family under the representative's name.
- Values are reais numeric(14,2) (not cents) to stay identical to the ported engine and its tests.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Save collaborator roles in one protected audited function. Why: no partial grants.
- Balance sums financial_account_movements through the America/Sao_Paulo cutoff; saldo_inicial is a movement, never added again. Future movements are forecast only in every financial RPC. Why: no double counting or future realized cash.
- fin_dre separates unclassified titles, missing cost centers, non-DRE natures, open installments and unreconciled lines. DRE gerencial reads fin_dre_base and matches fin_dre net profit. Why: one calculation, distinct indicators.
- Installment competencia falls back to title; changes only via fin_installment_competencia_set with reason/event; DRE sums by installment. Why: recurring contracts span months.
- Count transfers once on outgoing side; report is_implantacao transfers separately while showing both movements. Why: no doubling, preserved reconciliation.
- New reconciliation titles use fin_title_create (origem conciliacao, id_externo extrato:<line>); learned suggestions use fin_mesa_palpite only for new titles. Existing-title links read and preserve title classification. Why: no silent reclassification or automatic settlement.
- Reconciliation fees are separate movements, never installment adjustments: receipt=line allocation-fee; payment=allocation+fee. Why: fees do not increase debt.
- Asaas PAYMENT_RECEIVED settles linked installments via asaas_baixa_automatica: gross installment, separate fee, key asaas:baixa:<account>:<charge>. Cash receipts, refunds and disputes stay manual. Why: official idempotent settlement.
- Isolated bench applies supabase/migrations and nonduplicated drizzle/migrations; exclusions live in tests/isolado/pular.txt. Why: migration tool writes to drizzle.
- Cheques use fin_cheque_* custody and enter bank balance only at compensado via official settlement when linked; fin_caixa_fatias is insert-only. Why: no fake accounts or double counting.
- Card purchases hit DRE by purchase date/category; cartao_fatura payable is excluded from competencia; invoice payments split by line category. Why: no double counting.
- Historical fiado uses service-only cob_fiado_importar, idempotent batch+line, receivable sistema_origem fiado_historico, FIADO-HIST asset outside DRE; preserve immutable cob_fiado_linhas. Why: traceable debt without inflated revenue.
- Consultant charging uses consultora_pagamento_titulo on owned orders with valid CPF and Asaas engine signed by consultora_cobranca_config.ator_user_id; sales_orders.pay_* offsets kit settlement. Why: Lardan charging without finance permissions.
- Approved removals use service-only fin_expurgo_* with fin_expurgo_backup/audit_logs; zero-sum cancelled reversals use fin_expurgo_titulos_estornados. Why: reversible cleanup.
- Asaas button/daily cron sync uses /api/public/asaas/sync-matinal; asaas_conciliar_cobranca matches person by party/CPF/legacy first five externalReference digits only with unique person+value+due date or unique value within 60 days without competing charge; settle RECEIVED, cash manual. Why: no wrong match.
- Settlement reversal reverses its interest/discount; DFC nets reversal in original line; projected flow skips cheques represented by equal open receivable. Why: no residues/doubling.
- Date correction uses fin_estorno_data_corrigir with expected date, reason, immutable snapshots and atomic settlement/movement updates; invalidate account/cashflow queries. Why: consistent dated balances and concurrency protection.
- Person merges only via party_unificar after preview, all-or-nothing; preserve imported fiado/Asaas stage and moved ids in party_unificacoes. Why: traceable history/reversal.
- Subfolders have their own AGENTS.md; read before editing there. Why: preserve scoped rules.
- pdv_como only follows real-user validation and audit_logs with real actor; never exposed by GRANT. Why: audit identifies the clicker.
- Outside portfolio, representative sees only name/code/status/debt with restrito=true; blocked/departed consultants never move portfolio or reactivate through portal. Why: privacy and finance control.
- With asaas_accounts.conta_cartao_receber_id set, payment settles there, then asaas_cartao_creditar transfers to Asaas on credit_date idempotently; empty preserves old behavior. Why: accurate card credit timing.
- fin_installment_saldo = amount + interest/fine - discount/abatement - allocations, matching fin_installment_refresh. Why: discounted installments cannot falsely appear settled.
- Test-kit cleanup uses service-only kit_testes_cancelar with seven explicit expected cycles/quantities, official stock transfers and immutable snapshots; never delete history. Why: preserve stock and real remessas.

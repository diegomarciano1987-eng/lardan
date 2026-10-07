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

- Salvar múltiplos papéis de um colaborador por uma única função protegida e auditada, evitando estado parcial entre concessões.
- Account balance = sum of financial_account_movements up to the cutoff date (America/Sao_Paulo); saldo_inicial is itself a movement, never add financial_accounts.saldo_inicial_cents again. Why: avoids double counting across Visão geral/Contas/Fluxo.
- Movements dated after today are forecast only (previsto), never realized, in every financial RPC. Why: realized reports cannot include future dates.
- fin_dre reports unclassified titles, missing cost center, out-of-DRE natures, open installments and unreconciled lines as separate indicators. Why: "unpaid" is not "unclassified".
- Installment competência lives on financial_installments.competencia (null = title's), changed only via fin_installment_competencia_set with reason + title event; DRE competência sums per installment. Why: recurring contracts must not land in one month.
- Transfers count once per operation (outgoing side); transfers touching an is_implantacao account are reported separately; both movements stay visible. Why: avoid doubling and keep conciliation.
- Mesa de conciliação: 'novo lançamento' cria o título via fin_title_create (origem conciliacao, id_externo extrato:<linha>) e concilia na sequência; palpites de classificação vêm de fin_mesa_palpite (conciliações anteriores com o mesmo início de histórico). Why: aprender sem regra fixa e sem baixa automática.
- Bank fees in reconciliation are a separate ledger movement, never an installment adjustment (receipt: line = allocated − fee; payment: line = allocated + fee); why: fees must not raise the amount owed.
- DRE gerencial reads only from fin_dre_base and its lucro líquido must equal fin_dre for the same filters; why: one calculation rule, two views.
- Referral (indicação) commissions are computed only by a DB trigger when a kit cycle closes, stored once per cycle in referral_commissions with an item snapshot; why: transparent, idempotent, never recalculated retroactively when tiers change.
- Asaas PAYMENT_RECEIVED on a charge linked to an installment settles it automatically via asaas_baixa_automatica (official settlement engine, gross on installment, fee as separate movement, idempotency key asaas:baixa:<account>:<charge>); cash receipts, refunds and disputes stay manual. Why: paid in Asaas must be paid in Lardan without double counting.
- The isolated bench applies supabase/migrations plus drizzle/migrations files without a copy there (duplicates listed in tests/isolado/pular.txt). Why: the migration tool writes only to drizzle/migrations.
- PDV terminals enter by store number + password (bcrypt) + team member e-mail + 6-digit e-mailed code (bcrypt, 10 min, 5 tries) and keep only a token hash in an httpOnly cookie; sellers switch by per-member PIN, and every PDV operation runs through service_role-only pdv_* RPCs that re-check price, discount limit, stock, cash register and commission. Why: shared store device without exposing tables or trusting client prices.
- Only active internal sellers (party role vendedora_interna, ficha in vendedora_profiles, login linked via profiles.party_id) may join a PDV team that sells; enforced by trigger on pdv_membros. Why: keep consultants, clients and back-office out of store cash registers.
- Maleta acceptance under signature mode goes only through kit_assinatura_finalizar (Clicksign signed file stored first; trigger on kit_acceptances blocks direct accept unless mode is desligado). Why: release requires the consultant's own signed term.
- Cheques are custody (fin_cheques, via fin_cheque_* RPCs), never bank balance; cash earmarks per person are insert-only fin_caixa_fatias and move no money. Why: no fake accounts.
- Card purchases (fin_cartao_lancamentos) hit DRE by purchase date/category; the invoice's single payable (origem cartao_fatura) is excluded from competência and its payment split by line category. Why: no double counting.
- Fiado histórico entra como título a receber (sistema_origem fiado_historico, conta ativo FIADO-HIST fora da DRE) via cob_fiado_importar (service_role, idempotente por lote+linha), com a linha original imutável em cob_fiado_linhas. Why: lastro rastreável sem inflar receita.

- Consultant orders can be charged directly by Lardan via consultora_pagamento_titulo (consultant-owned order, valid CPF) + Asaas official engine signed by consultora_cobranca_config.ator_user_id; paid amount is recorded on sales_orders (pay_*) to offset the kit settlement. Why: charge stays in Lardan's name without giving consultants finance permissions.
- Asaas sync runs asaas_conciliacao_automatica after mirroring: links charge↔receivable installment only on unique same person (party or customer CPF/CNPJ) + cents + due date, then settles RECEIVED via asaas_baixa_pendentes. Why: auto-reconcile without guessing or double settlement.
- Asaas charge mirror sync runs daily via pg_cron → /api/public/asaas/sync-matinal (token ASAAS_SYNC_CRON_TOKEN, actor = consultora_cobranca_config.ator_user_id), sharing executarSyncAsaas with the manual button. Why: baixas must not depend on someone opening a screen.

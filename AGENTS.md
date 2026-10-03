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
- Public showcase never reserves stock: anonymous order RPC is revoked; interest goes through the consultant's WhatsApp. Why: no stock locked without human service.
- Consultant showcase design lives as draft/published jsonb on consultant_showcases, written only via showcase_design_* RPCs that re-validate against a fixed whitelist; why: atomic publish, no free-form styling.
- Showcase images sit in the private vitrine-originais bucket and reach the public only through /api/public/vitrine-img for paths in a live published design; why: public buckets are blocked and drafts must stay private.
- Help content lives in help_articles (audience publico|consultora, rascunho|publicado, RLS by audience, edited only by can_manage_content); screens open it in a side sheet via BotaoAjuda so in-progress forms are never lost.
- Consultant area uses the .area-consultora scope (48px touch, 16px inputs) and keeps the active tab in the URL (?aba=) so back/refresh return to the same place.
- Account balance = sum of financial_account_movements up to the cutoff date (America/Sao_Paulo); saldo_inicial is itself a movement, never add financial_accounts.saldo_inicial_cents again. Why: avoids double counting across Visão geral/Contas/Fluxo.
- Movements dated after today are forecast only (previsto), never realized, in every financial RPC. Why: realized reports cannot include future dates.
- fin_dre reports unclassified titles, missing cost center, out-of-DRE natures, open installments and unreconciled lines as separate indicators. Why: "unpaid" is not "unclassified".
- Installment competência lives on financial_installments.competencia (null = title's), changed only via fin_installment_competencia_set with reason + title event; DRE competência sums per installment. Why: recurring contracts must not land in one month.
- Transfers count once per operation (outgoing side); transfers touching an is_implantacao account are reported separately; both movements stay visible. Why: avoid doubling and keep conciliation.
- Mesa de conciliação: 'novo lançamento' cria o título via fin_title_create (origem conciliacao, id_externo extrato:<linha>) e concilia na sequência; palpites de classificação vêm de fin_mesa_palpite (conciliações anteriores com o mesmo início de histórico). Why: aprender sem regra fixa e sem baixa automática.
- Every database change is also saved as a file in supabase/migrations (the isolated test bench applies only that folder); why: one source of truth for migrations.
- Bank fees in reconciliation are a separate ledger movement, never an installment adjustment (receipt: line = allocated − fee; payment: line = allocated + fee); why: fees must not raise the amount owed.
- DRE gerencial reads only from fin_dre_base and its lucro líquido must equal fin_dre for the same filters; why: one calculation rule, two views.
- Referral (indicação) commissions are computed only by a DB trigger when a kit cycle closes, stored once per cycle in referral_commissions with an item snapshot; why: transparent, idempotent, never recalculated retroactively when tiers change.
- Showcase addresses are checked by showcase_slug_reserved (site routes, categories, pages, and old addresses kept forever in showcase_slug_history); why: one consultant's link can never be taken by another.

- Asaas PAYMENT_RECEIVED on a charge linked to an installment settles it automatically via asaas_baixa_automatica (official settlement engine, gross on installment, fee as separate movement, idempotency key asaas:baixa:<account>:<charge>); cash receipts, refunds and disputes stay manual. Why: paid in Asaas must be paid in Lardan without double counting.
- The isolated bench also applies drizzle/migrations files that have no copy in supabase/migrations. Why: the migration tool now writes only to drizzle/migrations.
- PDV terminals enter by store number + password (bcrypt) + team member e-mail + 6-digit e-mailed code (bcrypt, 10 min, 5 tries) and keep only a token hash in an httpOnly cookie; sellers switch by per-member PIN, and every PDV operation runs through service_role-only pdv_* RPCs that re-check price, discount limit, stock, cash register and commission. Why: shared store device without exposing tables or trusting client prices.

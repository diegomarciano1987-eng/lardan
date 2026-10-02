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

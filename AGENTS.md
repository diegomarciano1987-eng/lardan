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

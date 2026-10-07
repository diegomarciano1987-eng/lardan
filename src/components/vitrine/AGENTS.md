# Vitrine, área da consultora e ajuda

- Public showcase never reserves stock: anonymous order RPC is revoked; interest goes through the consultant's WhatsApp. Why: no stock locked without human service.
- Consultant showcase design lives as draft/published jsonb on consultant_showcases, written only via showcase_design_* RPCs that re-validate against a fixed whitelist; why: atomic publish.
- Showcase images sit in the private vitrine-originais bucket and reach the public only through /api/public/vitrine-img for paths in a live published design; why: public buckets are blocked and drafts must stay private.
- Help content lives in help_articles (audience publico|consultora, rascunho|publicado, RLS by audience, edited only by can_manage_content); screens open it in a side sheet via BotaoAjuda so in-progress forms are never lost.
- Consultant area uses the .area-consultora scope and keeps the active tab in ?aba= so back/refresh return there.
- Showcase addresses are checked by showcase_slug_reserved (site routes, categories, pages, showcase_slug_history); why: one consultant's link can never be taken by another.

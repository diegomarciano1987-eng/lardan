# Admin components

- Private admin, representative and store-terminal shells use OperationalGlass with an explicit path allowlist and temporary body tokens for portals; never theme public pages or change queries, permissions or print engines. Why: unified isolated appearance with operational safety.

- Display fiscal readiness via the authenticated fiscal_prontidao RPC, gated by finance.view, with no mutation controls. Why: one protected read-only report.
- Piece and maleta labels use enviarParaImpressora (hidden iframe) with explicit destination confirmation before browser print; station names live in Remessas and calibration remains in label search settings; never writes codes or stock, nor confirms physical success. Why: browsers cannot select a physical device and A4/Argox destinations must not be confused.
- Collaborator overview uses only actor-authenticated montagem_operacoes; scanner increments use montagem_item_operar and never infer authorship from existing composition. Why: atomic quantities and provable personal productivity.
- Maleta labels encode the existing kits.code and resolve through kit_identificacao_buscar; legacy QR tokens remain readable. Why: no parallel numbering and scoped identification.
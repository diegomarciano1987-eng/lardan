# Admin components

- Display fiscal readiness via the authenticated fiscal_prontidao RPC, gated by finance.view, with no mutation controls. Why: one protected read-only report.
- Piece labels print in one click through enviarParaImpressora (hidden iframe, no window/preview) using existing barcode/reference fields; calibration lives only in the search dialog's station settings; never writes codes or stock, nor confirms physical success. Why: direct-to-printer operation with honest status.
- Collaborator overview uses only actor-authenticated montagem_operacoes; scanner increments use montagem_item_operar and never infer authorship from existing composition. Why: atomic quantities and provable personal productivity.
- Maleta labels encode the existing kits.code and resolve through kit_identificacao_buscar; legacy QR tokens remain readable. Why: no parallel numbering and scoped identification.
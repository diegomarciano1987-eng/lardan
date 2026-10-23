# Admin components

- Display fiscal readiness via the authenticated fiscal_prontidao RPC, gated by finance.view, with no mutation controls. Why: one protected read-only report.
- Piece labels use the shared EtiquetasImprimir dialog and existing barcode/reference fields; browser print never writes codes or stock, nor confirms physical success. Why: consistent station calibration and honest status.
- Collaborator overview uses only actor-authenticated montagem_operacoes; scanner increments use montagem_item_operar and never infer authorship from existing composition. Why: atomic quantities and provable personal productivity.
- Maleta labels encode the existing kits.code and resolve through kit_identificacao_buscar; legacy QR tokens remain readable. Why: no parallel numbering and scoped identification.
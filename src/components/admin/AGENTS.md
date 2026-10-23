# Admin components

- Display fiscal readiness via the authenticated fiscal_prontidao RPC, gated by finance.view, with no mutation controls. Why: one protected read-only report.
- Piece labels use the shared EtiquetasImprimir dialog and existing barcode/reference fields; browser print never writes codes or stock, nor confirms physical success. Why: consistent station calibration and honest status.
import JsBarcode from "jsbarcode";

export interface EtiquetaItem {
  id: string;
  nome: string;
  barcode: string | null;
  referencia: string | null;
  quantidade: number;
}
export interface EtiquetaConfig {
  entrePistas: number;
  entreLinhas: number;
  margemEsquerda: number;
  margemSuperior: number;
  primeiraPista: number;
}
export const ETIQUETA = { largura: 25, altura: 12, pistas: 3, dpi: 203 } as const;
export const CONFIG_ETIQUETA: EtiquetaConfig = {
  entrePistas: 0, entreLinhas: 0, margemEsquerda: 0, margemSuperior: 0, primeiraPista: 1,
};

/** JsBarcode's object renderer is DOM-independent; never shorten or replace barcode data. */
export function barrasEtiqueta(codigo: string): string {
  if (!codigo.trim() || /[^\x20-\x7E]/.test(codigo)) throw new Error("Código de barras ausente ou incompatível com Code 128.");
  const target: { encodings?: { data: string }[] } = {};
  JsBarcode(target as unknown as SVGElement, codigo, { format: "CODE128", displayValue: false, margin: 0 });
  const bits = (target.encodings ?? []).map((e) => e.data).join("");
  if (!bits) throw new Error("Não foi possível gerar o código de barras.");
  // 10 quiet modules per side + 1 mm external margin, minimum module = one printer dot.
  if ((bits.length + 20) * 25.4 / ETIQUETA.dpi > 23) {
    throw new Error("Este código não cabe em 25 mm a 203 DPI sem reduzir a leitura. Revise o código cadastrado ou use uma etiqueta maior.");
  }
  return bits;
}

export function comporEtiquetas(itens: EtiquetaItem[], primeiraPista = 1): (EtiquetaItem | null)[][] {
  if (![1, 2, 3].includes(primeiraPista)) throw new Error("Pista inicial inválida.");
  const cells: (EtiquetaItem | null)[] = Array.from({ length: primeiraPista - 1 }, () => null);
  let total = 0;
  for (const item of itens) {
    if (!Number.isInteger(item.quantidade) || item.quantidade < 0) throw new Error("Quantidade deve ser inteira e não negativa.");
    total += item.quantidade;
    if (total > 3000) throw new Error("Divida a impressão em lotes de até 3.000 etiquetas.");
    if (item.quantidade === 0) continue;
    if (!item.barcode) throw new Error(`${item.nome}: sem código de barras cadastrado.`);
    barrasEtiqueta(item.barcode);
    for (let n = 0; n < item.quantidade; n++) cells.push(item);
  }
  if (!total) throw new Error("Escolha ao menos uma etiqueta.");
  while (cells.length % 3) cells.push(null);
  return Array.from({ length: cells.length / 3 }, (_, i) => cells.slice(i * 3, i * 3 + 3));
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function svgEtiqueta(codigo: string) {
  const bits = barrasEtiqueta(codigo);
  const width = bits.length + 20;
  const rects = [...bits].map((b, i) => b === "1" ? `<rect x="${i + 10}" y="0" width="1" height="32"/>` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(codigo)}" viewBox="0 0 ${width} 32" width="${width * 25.4 / 203}mm" height="4mm" shape-rendering="crispEdges">${rects}</svg>`;
}

export function documentoEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig): string {
  const rows = comporEtiquetas(itens, config.primeiraPista);
  for (const value of [config.entrePistas, config.entreLinhas, config.margemEsquerda, config.margemSuperior]) {
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error("Ajustes da fita devem estar entre 0 e 10 mm.");
  }
  const width = 75 + config.entrePistas * 2 + config.margemEsquerda;
  const height = 12 + config.entreLinhas + config.margemSuperior;
  const body = rows.map((row) => `<section>${row.map((item) => item ? `<article><div class="nome">${escapeHtml(item.nome)}</div>${svgEtiqueta(item.barcode ?? "")}<div class="referencia">${escapeHtml(item.referencia || item.barcode || "")}</div></article>` : "<article></article>").join("")}</section>`).join("");
  // Thermal output intentionally has its own fixed ink/paper tokens, independent of app theme.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas — LARDAN</title><style>
  :root{--ink:#000;--paper:#fff} @page{size:${width}mm ${height}mm;margin:0}
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--paper);color:var(--ink)}
  section{display:grid;grid-template-columns:repeat(3,25mm);column-gap:${config.entrePistas}mm;width:${width}mm;height:${height}mm;padding-left:${config.margemEsquerda}mm;padding-top:${config.margemSuperior}mm;break-after:page;page-break-after:always;overflow:hidden}
  section:last-child{break-after:auto;page-break-after:auto}
  article{width:25mm;height:12mm;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0.5mm 1mm;overflow:hidden;font-family:Arial,sans-serif;letter-spacing:0}
  .nome{font-size:5pt;font-weight:bold;line-height:1.15;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;margin-bottom:0.4mm}
  svg{display:block;flex-shrink:0;fill:var(--ink)}.referencia{font-size:5pt;line-height:1.2;margin-top:0.4mm;white-space:nowrap;max-width:100%;font-weight:bold}
  </style></head><body>${body}</body></html>`;
}
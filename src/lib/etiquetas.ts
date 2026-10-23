import JsBarcode from "jsbarcode";

export interface EtiquetaItem {
  id: string;
  nome: string;
  barcode: string | null;
  referencia: string | null;
  quantidade: number;
  precoCents?: number | null;
}

/** Linha inferior SISPR: referência à esquerda do traço, preço de venda em centavos com 6 dígitos à direita. */
export function textoEtiqueta(referencia: string | null, precoCents?: number | null): string {
  const ref = (referencia ?? "").trim();
  if (precoCents == null || !Number.isInteger(precoCents) || precoCents < 0) return ref;
  return `${ref}-${String(precoCents).padStart(6, "0")}`;
}
export interface EtiquetaConfig {
  entreLinhas: number;
  margemEsquerda: number;
  margemSuperior: number;
}
export const ETIQUETA = { largura: 95, suporte: 100, areaImpressao: 30, altura: 12, pistas: 1, intervalo: 3, dpi: 203 } as const;
export const CONFIG_ETIQUETA: EtiquetaConfig = {
  entreLinhas: 3, margemEsquerda: 0, margemSuperior: 0,
};

/** JsBarcode's object renderer is DOM-independent; never shorten or replace barcode data. */
export function barrasEtiqueta(codigo: string): string {
  if (!codigo.trim() || /[^\x20-\x7E]/.test(codigo)) throw new Error("Código de barras ausente ou incompatível com Code 128.");
  const target: { encodings?: { data: string }[] } = {};
  JsBarcode(target as unknown as SVGElement, codigo, { format: "CODE128", displayValue: false, margin: 0 });
  const bits = (target.encodings ?? []).map((e) => e.data).join("");
  if (!bits) throw new Error("Não foi possível gerar o código de barras.");
  // 10 quiet modules per side; minimum module = one dot, 0.1 mm outside each quiet zone.
  if ((bits.length + 20) * 25.4 / ETIQUETA.dpi > ETIQUETA.areaImpressao - 0.4) {
    throw new Error("Este código não cabe na área de 30 mm a 203 DPI sem reduzir a leitura. Use uma área maior sem alterar o código cadastrado.");
  }
  return bits;
}

export function comporEtiquetas(itens: EtiquetaItem[]): EtiquetaItem[][] {
  const cells: EtiquetaItem[] = [];
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
  return cells.map((item) => [item]);
}

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function svgEtiqueta(codigo: string) {
  const bits = barrasEtiqueta(codigo);
  const width = bits.length + 20;
  const rects = [...bits].map((b, i) => b === "1" ? `<rect x="${i + 10}" y="0" width="1" height="32"/>` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(codigo)}" viewBox="0 0 ${width} 32" width="${width * 25.4 / 203}mm" height="4mm" shape-rendering="crispEdges">${rects}</svg>`;
}

export function documentoEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig): string {
  const rows = comporEtiquetas(itens);
  for (const value of [config.entreLinhas, config.margemEsquerda, config.margemSuperior]) {
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error("Ajustes da fita devem estar entre 0 e 10 mm.");
  }
  if (config.margemSuperior > config.entreLinhas || config.margemEsquerda + ETIQUETA.largura > ETIQUETA.suporte) throw new Error("A calibração excede o suporte ou o intervalo do rolo.");
  const width = ETIQUETA.suporte;
  const height = ETIQUETA.altura + config.entreLinhas;
  const body = rows.map((row) => `<section>${row.map((item) => item ? `<article><div class="nome">${escapeHtml(item.nome.toUpperCase())}</div>${svgEtiqueta(item.barcode ?? "")}<div class="referencia">${escapeHtml(textoEtiqueta(item.referencia || item.barcode, item.precoCents))}</div></article>` : "<article></article>").join("")}</section>`).join("");
  // Thermal output intentionally has its own fixed ink/paper tokens, independent of app theme.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas — LARDAN</title><style>
  :root{--ink:#000;--paper:#fff} @page{size:${width}mm ${height}mm;margin:0}
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--paper);color:var(--ink)}
  section{width:${width}mm;height:${height}mm;padding-left:${config.margemEsquerda}mm;padding-top:${config.margemSuperior}mm;break-after:page;page-break-after:always;overflow:hidden}
  section:last-child{break-after:auto;page-break-after:auto}
  article{width:30mm;height:12mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0.4mm 0.6mm;overflow:hidden;font-family:"OCR-B","Consolas","Lucida Console","Courier New",monospace;letter-spacing:0}
  .nome{font-size:5pt;line-height:1.1;width:100%;white-space:nowrap;overflow:hidden;text-transform:uppercase;text-align:left;margin-bottom:0.3mm}
  svg{display:block;flex-shrink:0;fill:var(--ink);height:4.6mm;max-width:100%}.referencia{font-size:8.5pt;line-height:1;margin-top:0.3mm;white-space:nowrap;max-width:100%;text-align:left}
  </style></head><body>${body}</body></html>`;
}
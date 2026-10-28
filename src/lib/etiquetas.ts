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
  /** Largura útil da área impressa (mm), alça à direita fora dela. */
  areaLargura?: number;
  /** Altura das barras (mm). */
  alturaBarras?: number;
  /** Tamanho da letra do nome e da referência (pt). */
  fonteNome?: number;
  fonteReferencia?: number;
}
export const ETIQUETA = { largura: 95, suporte: 100, areaImpressao: 30, altura: 12, pistas: 1, intervalo: 3, dpi: 203 } as const;
export const CONFIG_ETIQUETA: EtiquetaConfig = {
  entreLinhas: 3, margemEsquerda: 0, margemSuperior: 0,
  areaLargura: 30, alturaBarras: 4.6, fonteNome: 5, fonteReferencia: 8.5,
};
export const LIMITES_CALIBRACAO = {
  entreLinhas: [0, 10], margemEsquerda: [0, 5], margemSuperior: [0, 10],
  areaLargura: [20, 60], alturaBarras: [2.5, 8], fonteNome: [3, 9], fonteReferencia: [5, 12],
} as const;
export const CALIBRACAO_KEY = "lardan.etiquetas.argox.alca-direita.v2";
export function completarConfig(c: Partial<EtiquetaConfig> | null | undefined): Required<EtiquetaConfig> {
  const base = CONFIG_ETIQUETA as Required<EtiquetaConfig>;
  const out = { ...base } as Required<EtiquetaConfig>;
  for (const k of Object.keys(base) as (keyof EtiquetaConfig)[]) {
    const v = c?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
/** Retorna mensagem de erro ou null. */
export function validarCalibracao(c: EtiquetaConfig): string | null {
  const f = completarConfig(c);
  for (const [k, [min, max]] of Object.entries(LIMITES_CALIBRACAO) as [keyof EtiquetaConfig, readonly [number, number]][]) {
    const v = c[k] ?? f[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return `Valor fora do limite (${min} a ${max}).`;
  }
  if (f.margemSuperior > f.entreLinhas) return "Margem superior não pode passar do espaço entre etiquetas.";
  if (f.margemEsquerda + ETIQUETA.largura > ETIQUETA.suporte) return "A calibração excede o suporte de 100 mm.";
  if (f.alturaBarras > ETIQUETA.altura - 3) return "Barras altas demais para a etiqueta de 12 mm.";
  return null;
}

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

export function svgEtiqueta(codigo: string, area: number = ETIQUETA.areaImpressao) {
  const bits = barrasEtiqueta(codigo);
  const width = bits.length + 20;
  // Módulo inteiro de pontos (2, 3…) para ocupar a largura útil como na etiqueta SISPR, sem distorcer barras.
  const k = Math.max(1, Math.floor(((area - 1.2) * ETIQUETA.dpi / 25.4) / width));
  const rects = [...bits].map((b, i) => b === "1" ? `<rect x="${i + 10}" y="0" width="1" height="32"/>` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(codigo)}" viewBox="0 0 ${width} 32" width="${width * k * 25.4 / ETIQUETA.dpi}mm" preserveAspectRatio="none" height="4mm" shape-rendering="crispEdges">${rects}</svg>`;
}

function folha(body: string, cfg: Required<EtiquetaConfig>, extra = "") {
  const width = ETIQUETA.suporte;
  const height = ETIQUETA.altura + cfg.entreLinhas;
  // Thermal output intentionally has its own fixed ink/paper tokens, independent of app theme.
  // Título vazio: se o navegador ainda imprimir cabeçalhos, nada inútil aparece na fita.
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>&#8203;</title><style>
  :root{--ink:#000;--paper:#fff} @page{size:${width}mm ${height}mm;margin:0}
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
  section{position:relative;width:${width}mm;height:${height}mm;padding-left:${cfg.margemEsquerda}mm;padding-top:${cfg.margemSuperior}mm;break-after:page;page-break-after:always;overflow:hidden}
  section:last-child{break-after:auto;page-break-after:auto}
  article{width:${cfg.areaLargura}mm;height:12mm;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0.4mm 0.6mm;overflow:hidden;font-family:"OCR-B","Consolas","Lucida Console","Courier New",monospace;letter-spacing:0}
  .nome{font-size:${cfg.fonteNome}pt;line-height:1.1;width:100%;white-space:nowrap;overflow:hidden;text-transform:uppercase;text-align:left;margin-bottom:0.3mm}
  svg{display:block;flex-shrink:0;fill:var(--ink);height:${cfg.alturaBarras}mm;max-width:100%;margin-left:-0.6mm}.referencia{font-size:${cfg.fonteReferencia}pt;line-height:1;margin-top:0.3mm;white-space:nowrap;max-width:100%;text-align:left}
  ${extra}</style></head><body>${body}</body></html>`;
}

export function documentoEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig): string {
  const rows = comporEtiquetas(itens);
  const erro = validarCalibracao(config);
  if (erro) throw new Error(erro);
  const cfg = completarConfig(config);
  const body = rows.map((row) => `<section>${row.map((item) => item ? `<article><div class="nome">${escapeHtml(item.nome.toUpperCase())}</div>${svgEtiqueta(item.barcode ?? "", cfg.areaLargura)}<div class="referencia">${escapeHtml(textoEtiqueta(item.referencia || item.barcode, item.precoCents))}</div></article>` : "<article></article>").join("")}</section>`).join("");
  return folha(body, cfg);
}

/** Amostra fixa do modelo SISPR usada só para calibrar; não consulta nem altera cadastro. */
export const AMOSTRA_CALIBRACAO: EtiquetaItem = { id: "calibracao", nome: "BR PR CIRCULO CRUZ", barcode: "LBRP0295-005499", referencia: "LBRP0295", precoCents: 5499, quantidade: 1 };

/**
 * Folha de teste: "amostra" imprime a etiqueta modelo; "regua" imprime moldura
 * da área útil com marcas a cada 1 mm/5 mm para medir o deslocamento na fita.
 */
export function documentoTeste(modo: "amostra" | "regua", config: EtiquetaConfig, copias = 1): string {
  const erro = validarCalibracao(config);
  if (erro) throw new Error(erro);
  const cfg = completarConfig(config);
  const n = Math.min(Math.max(1, Math.trunc(copias)), 5);
  if (modo === "amostra") return documentoEtiquetas([{ ...AMOSTRA_CALIBRACAO, quantidade: n }], cfg);
  const marcas = Array.from({ length: Math.floor(cfg.areaLargura) + 1 }, (_, i) => `<i style="left:${i}mm;height:${i % 5 ? 1.2 : 2.6}mm"></i>`).join("");
  const regua = `<article class="regua"><div class="marcas">${marcas}</div><b>X ${cfg.margemEsquerda.toFixed(1)} · Y ${cfg.margemSuperior.toFixed(1)} · ${cfg.areaLargura}mm</b></article>`;
  const extra = `.regua{position:relative;border:0.25mm solid var(--ink);justify-content:flex-end}.marcas{position:absolute;left:0;top:0;width:100%;height:3mm}.marcas i{position:absolute;top:0;width:0.2mm;background:var(--ink)}.regua b{font:700 6pt monospace;padding-bottom:0.6mm}`;
  return folha(Array.from({ length: n }, () => `<section>${regua}</section>`).join(""), cfg, extra);
}

export function lerCalibracao(): Required<EtiquetaConfig> {
  try { return completarConfig(JSON.parse(localStorage.getItem(CALIBRACAO_KEY) ?? "null")); } catch { return completarConfig(null); }
}
export function salvarCalibracao(c: EtiquetaConfig) {
  const erro = validarCalibracao(c); if (erro) throw new Error(erro);
  localStorage.setItem(CALIBRACAO_KEY, JSON.stringify(completarConfig(c)));
}

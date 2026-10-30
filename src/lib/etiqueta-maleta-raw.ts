import { barrasEtiqueta } from "@/lib/etiquetas";
import type { LinguagemArgox } from "@/lib/etiquetas-raw";

/**
 * Etiqueta da MALETA: papel próprio de 48 mm de largura × 28 mm de altura (diferente da etiqueta de joia).
 * Mesma Argox e mesmo QZ Tray da estação; 203 DPI = 8 pontos/mm.
 * Conteúdo (igual à etiqueta antiga + nosso código de barras): código - nome da cliente, cidade/UF,
 * representante, código de barras da maleta, número da remessa (grande) e número da maleta na remessa.
 */
export const ETIQUETA_MALETA = { largura: 48, altura: 28, gap: 2 } as const;
const D = 8;
const pt = (mm: number) => Math.round(mm * D);
const limpo = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["\\^~]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

export interface DadosEtiquetaMaleta {
  cliente_codigo?: string | null;
  cliente_nome?: string | null;
  cidade?: string | null;
  representante?: string | null;
  remessa_numero?: number | null;
  maleta_numero?: number | null;
}

export function linhasEtiquetaMaleta(d: DadosEtiquetaMaleta) {
  const cod = d.cliente_codigo ? limpo(d.cliente_codigo).replace(/^LC-0*/, "") : "";
  const nome = limpo(d.cliente_nome ?? "");
  return {
    l1: (cod && nome ? `${cod} - ${nome}` : nome || cod).slice(0, 36),
    l2: limpo(d.cidade ?? "").slice(0, 36),
    l3: limpo(d.representante ?? "").slice(0, 36),
    remessa: d.remessa_numero != null ? String(d.remessa_numero) : "",
    maleta: d.maleta_numero != null ? String(d.maleta_numero) : "",
  };
}

export function comandosEtiquetaMaleta(codigo: string, ling: LinguagemArgox, copias = 1, dados: DadosEtiquetaMaleta = {}): string {
  const bits = barrasEtiqueta(codigo); // valida o código
  const larg = pt(ETIQUETA_MALETA.largura), alt = pt(ETIQUETA_MALETA.altura), gap = pt(ETIQUETA_MALETA.gap);
  const margem = pt(2);
  const modulo = Math.max(1, Math.min(4, Math.floor((larg - 2 * margem) / (bits.length + 20))));
  const larguraBarras = (bits.length + 20) * modulo;
  const xBar = Math.max(margem, Math.round((larg - larguraBarras) / 2));
  const L = linhasEtiquetaMaleta(dados);
  const y1 = pt(1), y2 = pt(3.6), y3 = pt(6.2), yBar = pt(8.6), hBar = pt(12.4), yBig = pt(21.4);
  const n = Math.max(1, Math.trunc(copias));
  if (ling === "pplz") {
    return [
      "^XA", `^PW${larg}`, `^LL${alt}`, "^LH0,0", "^PON", "^MNY",
      `^FO${margem},${y1}^A0N,20,18^FD${L.l1}^FS`,
      `^FO${margem},${y2}^A0N,20,18^FD${L.l2}^FS`,
      `^FO${margem},${y3}^A0N,20,18^FD${L.l3}^FS`,
      `^FO${xBar},${yBar}^BY${modulo}^BCN,${hBar},N,N,N^FD${codigo}^FS`,
      `^FO${margem},${yBig}^A0N,64,52^FD${L.remessa}^FS`,
      `^FO0,${yBig}^FB${larg - margem},1,0,R^A0N,64,52^FD${L.maleta}^FS`,
      `^PQ${n}`, "^XZ", "",
    ].join("\n");
  }
  if (ling === "ppla") {
    // PPLA: linha (0,1 mm) contada a partir da base da etiqueta.
    const S = "\x02", d = (v: number, w: number) => String(Math.max(0, Math.round(v))).padStart(w, "0");
    const base = (yDots: number, hMm: number) => d((ETIQUETA_MALETA.altura - yDots / D - hMm) * 10, 4);
    const col = d(20, 4), colBar = d((xBar / D) * 10, 4), colDir = d(400, 4);
    const m = Math.max(1, Math.min(9, modulo));
    return [
      `${S}m`, `${S}L`, "D11", "H12",
      `1211000${base(y1, 2.2)}${col}${L.l1}`,
      `1211000${base(y2, 2.2)}${col}${L.l2}`,
      `1211000${base(y3, 2.2)}${col}${L.l3}`,
      `1e${m}${m}${d(hBar, 3)}${base(yBar, 8)}${colBar}${codigo}`,
      `1422000${base(yBig, 8)}${col}${L.remessa}`,
      `1422000${base(yBig, 8)}${colDir}${L.maleta}`,
      `Q${d(n, 4)}`, "E", "",
    ].join("\r\n");
  }
  // PPLB / EPL — fonte 2 = 10×16 pontos; fonte 4 = 14×24 (×2 = 28×48)
  const xDir = Math.max(margem, larg - margem - L.maleta.length * 28);
  return [
    "", "N", `q${larg}`, `Q${alt},${gap}`, "ZT", "S2", "D10",
    `A${margem},${y1},0,2,1,1,N,"${L.l1}"`,
    `A${margem},${y2},0,2,1,1,N,"${L.l2}"`,
    `A${margem},${y3},0,2,1,1,N,"${L.l3}"`,
    `B${xBar},${yBar},0,1,${modulo},${modulo},${hBar},N,"${codigo}"`,
    `A${margem},${yBig},0,4,2,2,N,"${L.remessa}"`,
    `A${xDir},${yBig},0,4,2,2,N,"${L.maleta}"`,
    `P${n}`, "",
  ].join("\n");
}

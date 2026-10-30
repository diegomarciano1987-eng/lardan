import { barrasEtiqueta } from "@/lib/etiquetas";
import type { LinguagemArgox } from "@/lib/etiquetas-raw";

/**
 * Etiqueta da MALETA: papel próprio de 48 mm de largura × 28 mm de altura (diferente da etiqueta de joia).
 * Mesma Argox e mesmo QZ Tray da estação; 203 DPI = 8 pontos/mm.
 */
export const ETIQUETA_MALETA = { largura: 48, altura: 28, gap: 2 } as const;
const D = 8;
const pt = (mm: number) => Math.round(mm * D);
const limpo = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["\\^~]/g, " ").toUpperCase();

export function comandosEtiquetaMaleta(codigo: string, ling: LinguagemArgox, copias = 1, titulo = "MALETA"): string {
  const bits = barrasEtiqueta(codigo); // valida o código
  const larg = pt(ETIQUETA_MALETA.largura), alt = pt(ETIQUETA_MALETA.altura), gap = pt(ETIQUETA_MALETA.gap);
  const margem = pt(2);
  const modulo = Math.max(1, Math.min(3, Math.floor((larg - 2 * margem) / (bits.length + 20))));
  const larguraBarras = (bits.length + 20) * modulo;
  const xBar = Math.max(margem, Math.round((larg - larguraBarras) / 2));
  const hBar = pt(13);
  const yTit = pt(1.5), yBar = pt(5.5), yCod = yBar + hBar + pt(1);
  const cod = limpo(codigo), tit = limpo(titulo).slice(0, 20);
  const n = Math.max(1, Math.trunc(copias));
  if (ling === "pplz") {
    return [
      "^XA", `^PW${larg}`, `^LL${alt}`, "^LH0,0", "^PON", "^MNY",
      `^FO0,${yTit}^FB${larg},1,0,C^A0N,26,22^FD${tit}^FS`,
      `^FO${xBar},${yBar}^BY${modulo}^BCN,${hBar},N,N,N^FD${codigo}^FS`,
      `^FO0,${yCod}^FB${larg},1,0,C^A0N,34,30^FD${cod}^FS`,
      `^PQ${n}`, "^XZ", "",
    ].join("\n");
  }
  if (ling === "ppla") {
    const S = "\x02", d = (v: number, w: number) => String(Math.max(0, Math.round(v))).padStart(w, "0");
    const col = d(20, 4), colBar = d((xBar / D) * 10, 4);
    const m = Math.max(1, Math.min(9, modulo));
    return [
      `${S}m`, `${S}L`, "D11", "H12",
      `1311000${d(240, 4)}${col}${tit}`,
      `1e${m}${m}${d(130, 3)}${d(90, 4)}${colBar}${codigo}`,
      `1411000${d(20, 4)}${col}${cod}`,
      `Q${d(n, 4)}`, "E", "",
    ].join("\r\n");
  }
  // PPLB / EPL
  const xTxt = (s: string, w: number) => Math.max(margem, Math.round((larg - s.length * w) / 2));
  return [
    "", "N", `q${larg}`, `Q${alt},${gap}`, "ZT", "S2", "D10",
    `A${xTxt(tit, 10)},${yTit},0,2,1,1,N,"${tit}"`,
    `B${xBar},${yBar},0,1,${modulo},${modulo},${hBar},N,"${codigo}"`,
    `A${xTxt(cod, 16)},${yCod},0,4,1,1,N,"${cod}"`,
    `P${n}`, "",
  ].join("\n");
}

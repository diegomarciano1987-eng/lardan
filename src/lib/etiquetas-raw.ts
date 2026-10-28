import {
  AMOSTRA_CALIBRACAO, ETIQUETA, barrasEtiqueta, completarConfig, comporEtiquetas, textoEtiqueta, validarCalibracao,
  type EtiquetaConfig, type EtiquetaItem,
} from "@/lib/etiquetas";

/**
 * Comandos nativos da Argox (203 DPI = 8 pontos/mm) para a etiqueta de joia 100 × 12 mm.
 * A impressora recebe o tamanho exato da etiqueta: sem papel do Windows, sem tela do navegador, sem girar.
 * PPLB = linguagem EPL; PPLZ = linguagem ZPL. As duas existem nas Argox de mesa.
 */
export type LinguagemArgox = "pplb" | "pplz" | "ppla";
const D = 8; // 203 DPI = 8 pontos por mm na Argox
const pt = (mm: number) => Math.round(mm * D);
const limpo = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["\\^~]/g, " ").toUpperCase();

function medidas(cfg: Required<EtiquetaConfig>, codigo: string) {
  const bits = barrasEtiqueta(codigo);
  const modulo = Math.max(1, Math.floor((pt(cfg.areaLargura) - pt(1.2)) / (bits.length + 20)));
  const x = pt(cfg.margemEsquerda + 0.6);
  const y = pt(cfg.margemSuperior + 0.4);
  const hNome = Math.max(10, pt(cfg.fonteNome * 0.3528 * 1.1));
  const hBar = pt(cfg.alturaBarras);
  const yBar = y + hNome + pt(0.4);
  const yRef = yBar + hBar + pt(0.4);
  const hRef = Math.max(14, pt(cfg.fonteReferencia * 0.3528 * 0.9));
  const maxCar = Math.max(4, Math.floor(pt(cfg.areaLargura - 1.2) / Math.max(6, Math.round(hNome * 0.6))));
  return { modulo, x, y, hNome, hBar, yBar, yRef, hRef, maxCar };
}

function etiqueta(item: EtiquetaItem, copias: number, cfg: Required<EtiquetaConfig>, ling: LinguagemArgox): string {
  const codigo = item.barcode ?? "";
  const m = medidas(cfg, codigo);
  const nome = limpo(item.nome).slice(0, ling === "pplb" ? Math.floor(pt(cfg.areaLargura - 1.2) / 10) : m.maxCar);
  const ref = limpo(textoEtiqueta(item.referencia || item.barcode, item.precoCents));
  const larg = pt(ETIQUETA.suporte), alt = pt(ETIQUETA.altura), gap = pt(cfg.entreLinhas);
  if (ling === "pplz") {
    return [
      "^XA", `^PW${larg}`, `^LL${alt}`, "^LH0,0", "^PON", "^MNY",
      `^FO${m.x},${m.y}^A0N,${m.hNome},${Math.round(m.hNome * 0.75)}^FD${nome}^FS`,
      `^FO${m.x},${m.yBar}^BY${m.modulo}^BCN,${m.hBar},N,N,N^FD${codigo}^FS`,
      `^FO${m.x},${m.yRef}^A0N,${m.hRef},${Math.round(m.hRef * 0.7)}^FD${ref}^FS`,
      `^PQ${copias}`, "^XZ", "",
    ].join("\n");
  }
  if (ling === "ppla") {
    // PPLA (Datamax): STX + comandos, unidade métrica 0,1 mm, linha medida a partir da base da etiqueta
    const S = "\x02", d = (n: number, w: number) => String(Math.max(0, Math.round(n))).padStart(w, "0");
    const col = d((cfg.margemEsquerda + 0.6) * 10, 4);
    const altMm = ETIQUETA.altura - cfg.margemSuperior;
    const hBarMm = cfg.alturaBarras;
    const yNome = (altMm - 2.6) * 10, yBar = (altMm - 3.2 - hBarMm) * 10, yRef = Math.max(0, yBar - 26);
    const n = Math.max(1, Math.min(9, m.modulo));
    return [
      `${S}m`, `${S}L`, "D11", "H12",
      `1211000${d(yNome, 4)}${col}${nome}`,
      `1E${n}${n}${d(hBarMm * 10, 3)}${d(yBar, 4)}${col}${codigo}`,
      `1211000${d(yRef, 4)}${col}${ref}`,
      `Q${d(copias, 4)}`, "E", "",
    ].join("\r\n");
  }
  // PPLB / EPL: fonte 1 = 8×12 pontos, fonte 2 = 10×16, fonte 3 = 12×20
  // posições próprias: fonte 1 tem 12 pontos de altura; tudo cabe nos 96 pontos (12 mm)
  const yBar = m.y + 14, yRef = yBar + m.hBar + 2;
  const fRef = yRef + 20 <= alt && ref.length * 14 <= pt(cfg.areaLargura) ? 3 : 2;
  return [
    "", "N", `q${larg}`, `Q${alt},${gap}`, "ZT", "S2", "D10",
    `A${m.x},${m.y},0,1,1,1,N,"${nome}"`,
    `B${m.x},${yBar},0,1,${m.modulo},${m.modulo},${m.hBar},N,"${codigo}"`,
    `A${m.x},${yRef},0,${fRef},1,1,N,"${ref}"`,
    `P${copias}`, "",
  ].join("\n");
}

/** Um bloco por peça, com a quantidade como cópias na própria impressora. */
export function comandosEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig, ling: LinguagemArgox): string {
  const erro = validarCalibracao(config); if (erro) throw new Error(erro);
  comporEtiquetas(itens); // mesmas validações de código/quantidade da folha
  const cfg = completarConfig(config);
  return itens.filter((i) => i.quantidade > 0).map((i) => etiqueta(i, i.quantidade, cfg, ling)).join("");
}

export function comandosTeste(config: EtiquetaConfig, ling: LinguagemArgox, copias = 3) {
  return comandosEtiquetas([{ ...AMOSTRA_CALIBRACAO, quantidade: Math.min(Math.max(1, Math.trunc(copias)), 5) }], config, ling);
}

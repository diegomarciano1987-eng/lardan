import {
  AMOSTRA_ANEL, AMOSTRA_CALIBRACAO, ETIQUETA, barrasEtiqueta, completarConfig, comporEtiquetas, nomeComEspacoAro, textoEtiqueta, validarCalibracao,
  type EtiquetaConfig, type EtiquetaItem, type OpcoesEtiqueta,
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

/**
 * 0340: cada etiqueta física pode levar 1 ou 2 "lados" (o mesmo bloco repetido ao lado, como na etiqueta antiga),
 * e o anel leva o aro no canto direito da linha do nome, sempre com espaço reservado.
 */
function etiqueta(item: EtiquetaItem, copias: number, cfg: Required<EtiquetaConfig>, ling: LinguagemArgox, duplicar = false): string {
  const codigo = item.barcode ?? "";
  const m = medidas(cfg, codigo);
  const aro = item.aro ? limpo(item.aro).replace(/[^0-9]/g, "").slice(0, 2) : "";
  const util = pt(cfg.areaLargura - 1.2); // largura útil de cada lado em pontos
  const nome = nomeComEspacoAro(limpo(item.nome), ling === "pplb" ? Math.floor(util / 10) : m.maxCar, aro || null);
  const ref = limpo(textoEtiqueta(item.referencia || item.barcode, item.precoCents));
  const larg = pt(ETIQUETA.suporte), alt = pt(ETIQUETA.altura), gap = pt(cfg.entreLinhas);
  const lados = duplicar ? [0, pt(cfg.segundoLado)] : [0];
  if (ling === "pplz") {
    const wNome = Math.round(m.hNome * 0.75);
    return [
      "^XA", `^PW${larg}`, `^LL${alt}`, "^LH0,0", "^PON", "^MNY",
      ...lados.flatMap((dx) => [
        `^FO${m.x + dx},${m.y}^A0N,${m.hNome},${wNome}^FD${nome}^FS`,
        ...(aro ? [`^FO${m.x + dx},${m.y}^A0N,${m.hNome},${wNome}^FB${util},1,0,R^FD${aro}^FS`] : []),
        `^FO${m.x + dx},${m.yBar}^BY${m.modulo}^BCN,${m.hBar},N,N,N^FD${codigo}^FS`,
        `^FO${m.x + dx},${m.yRef}^A0N,${m.hRef},${Math.round(m.hRef * 0.7)}^FD${ref}^FS`,
      ]),
      `^PQ${copias}`, "^XZ", "",
    ].join("\n");
  }
  if (ling === "ppla") {
    // PPLA (Datamax): STX + comandos, unidade métrica 0,1 mm, linha medida a partir da base da etiqueta
    const S = "\x02", d = (n: number, w: number) => String(Math.max(0, Math.round(n))).padStart(w, "0");
    const altMm = ETIQUETA.altura - cfg.margemSuperior;
    const hBarMm = cfg.alturaBarras;
    const yNome = (altMm - 2.6) * 10, yBar = (altMm - 3.2 - hBarMm) * 10, yRef = Math.max(0, yBar - 26);
    const n = Math.max(1, Math.min(9, m.modulo));
    return [
      `${S}m`, `${S}L`, "D11", "H12",
      ...lados.flatMap((dx) => {
        const x0 = cfg.margemEsquerda + 0.6 + dx / D;
        const col = d(x0 * 10, 4);
        return [
          `1211000${d(yNome, 4)}${col}${nome}`,
          // aro alinhado à direita da área útil (fonte 2 ≈ 1,4 mm por caractere)
          ...(aro ? [`1211000${d(yNome, 4)}${d((x0 + cfg.areaLargura - 1.2 - aro.length * 1.4) * 10, 4)}${aro}`] : []),
          // "e" minúsculo = Code 128 SEM texto legível embaixo (o "E" maiúsculo repetia referência e preço)
          `1e${n}${n}${d(hBarMm * 10, 3)}${d(yBar, 4)}${col}${codigo}`,
          `1211000${d(yRef, 4)}${col}${ref}`,
        ];
      }),
      `Q${d(copias, 4)}`, "E", "",
    ].join("\r\n");
  }
  // PPLB / EPL: fonte 1 = 8×12 pontos (10 pontos por caractere com o espaço), fonte 2 = 10×16, fonte 3 = 12×20
  // posições próprias: fonte 1 tem 12 pontos de altura; tudo cabe nos 96 pontos (12 mm)
  const yBar = m.y + 14, yRef = yBar + m.hBar + 2;
  const fRef = yRef + 20 <= alt && ref.length * 14 <= pt(cfg.areaLargura) ? 3 : 2;
  return [
    "", "N", `q${larg}`, `Q${alt},${gap}`, "ZT", "S2", "D10",
    ...lados.flatMap((dx) => [
      `A${m.x + dx},${m.y},0,1,1,1,N,"${nome}"`,
      ...(aro ? [`A${m.x + dx + util - aro.length * 10},${m.y},0,1,1,1,N,"${aro}"`] : []),
      `B${m.x + dx},${yBar},0,1,${m.modulo},${m.modulo},${m.hBar},N,"${codigo}"`,
      `A${m.x + dx},${yRef},0,${fRef},1,1,N,"${ref}"`,
    ]),
    `P${copias}`, "",
  ].join("\n");
}

/** Um bloco por peça, com a quantidade como cópias na própria impressora. */
export function comandosEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig, ling: LinguagemArgox, op: OpcoesEtiqueta = {}): string {
  const erro = validarCalibracao(config, op); if (erro) throw new Error(erro);
  comporEtiquetas(itens); // mesmas validações de código/quantidade da folha
  const cfg = completarConfig(config);
  return itens.filter((i) => i.quantidade > 0).map((i) => etiqueta(i, i.quantidade, cfg, ling, !!op.duplicar)).join("");
}

export function comandosTeste(config: EtiquetaConfig, ling: LinguagemArgox, copias = 3, op: OpcoesEtiqueta & { anel?: boolean } = {}) {
  const amostra = op.anel ? AMOSTRA_ANEL : AMOSTRA_CALIBRACAO;
  return comandosEtiquetas([{ ...amostra, quantidade: Math.min(Math.max(1, Math.trunc(copias)), 5) }], config, ling, { duplicar: op.duplicar === true });
}

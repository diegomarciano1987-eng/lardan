import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  AMOSTRA_CALIBRACAO, ETIQUETA, barrasEtiqueta, completarConfig, comporEtiquetas, textoEtiqueta, validarCalibracao,
  type EtiquetaConfig, type EtiquetaItem,
} from "@/lib/etiquetas";

/**
 * Etiqueta Argox como PDF do tamanho exato da fita (100 mm × 12 mm + espaço), na horizontal.
 * PDF não recebe cabeçalho/rodapé do navegador (data, endereço, título) e não gira para retrato.
 */
const MM = 72 / 25.4;

export async function pdfEtiquetas(itens: EtiquetaItem[], config: EtiquetaConfig, regua = false): Promise<Uint8Array> {
  const erro = validarCalibracao(config); if (erro) throw new Error(erro);
  const cfg = completarConfig(config);
  const rows = regua ? itens.flatMap((i) => Array.from({ length: i.quantidade }, () => [i])) : comporEtiquetas(itens);
  const pdf = await PDFDocument.create();
  pdf.setTitle(" "); pdf.setProducer("LARDAN"); pdf.setCreator("LARDAN");
  const fonte = await pdf.embedFont(StandardFonts.Courier);
  const negrito = await pdf.embedFont(StandardFonts.CourierBold);
  const W = ETIQUETA.suporte * MM;
  const H = (ETIQUETA.altura + cfg.entreLinhas) * MM;
  const preto = rgb(0, 0, 0);
  for (const [item] of rows) {
    if (!item) continue;
    const page = pdf.addPage([W, H]);
    const x0 = (cfg.margemEsquerda + 0.6) * MM;
    const topo = H - (cfg.margemSuperior + 0.4) * MM;
    const area = cfg.areaLargura * MM;
    if (regua) {
      page.drawRectangle({ x: cfg.margemEsquerda * MM, y: H - (cfg.margemSuperior + ETIQUETA.altura) * MM, width: area, height: ETIQUETA.altura * MM, borderColor: preto, borderWidth: 0.7 });
      for (let i = 0; i <= Math.floor(cfg.areaLargura); i++) {
        const h = (i % 5 ? 1.2 : 2.6) * MM;
        page.drawRectangle({ x: (cfg.margemEsquerda + i) * MM, y: H - cfg.margemSuperior * MM - h, width: 0.2 * MM, height: h, color: preto });
      }
      page.drawText(`X ${cfg.margemEsquerda.toFixed(1)} Y ${cfg.margemSuperior.toFixed(1)} ${cfg.areaLargura}mm`, { x: x0, y: H - (cfg.margemSuperior + 10.5) * MM, size: 6, font: negrito, color: preto });
      continue;
    }
    // nome
    let nome = item.nome.toUpperCase();
    while (nome.length > 1 && fonte.widthOfTextAtSize(nome, cfg.fonteNome) > area - 1.2 * MM) nome = nome.slice(0, -1);
    const yNome = topo - cfg.fonteNome * 0.85;
    page.drawText(nome, { x: x0, y: yNome, size: cfg.fonteNome, font: fonte, color: preto });
    // barras (módulo inteiro de pontos de 203 DPI)
    const bits = barrasEtiqueta(item.barcode ?? "");
    const total = bits.length + 20;
    const k = Math.max(1, Math.floor(((cfg.areaLargura - 1.2) * ETIQUETA.dpi / 25.4) / total));
    const mod = (k * 25.4 / ETIQUETA.dpi) * MM;
    const hBar = cfg.alturaBarras * MM;
    const yBar = yNome - 0.4 * MM - hBar;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== "1") continue;
      let j = i; while (bits[j + 1] === "1") j++;
      page.drawRectangle({ x: x0 + (i + 10) * mod - 10 * mod, y: yBar, width: (j - i + 1) * mod, height: hBar, color: preto });
      i = j;
    }
    // referência-preço
    page.drawText(textoEtiqueta(item.referencia || item.barcode, item.precoCents), { x: x0, y: yBar - 0.4 * MM - cfg.fonteReferencia * 0.8, size: cfg.fonteReferencia, font: fonte, color: preto });
  }
  return pdf.save();
}

export async function pdfTeste(modo: "amostra" | "regua", config: EtiquetaConfig, copias = 1) {
  const n = Math.min(Math.max(1, Math.trunc(copias)), 5);
  return pdfEtiquetas([{ ...AMOSTRA_CALIBRACAO, quantidade: n }], config, modo === "regua");
}

/** Imprime o PDF direto (quadro invisível), sem janela intermediária. */
export function imprimirPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  frame.onload = () => { window.setTimeout(() => { try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.open(url, "_blank"); } }, 300); };
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
}

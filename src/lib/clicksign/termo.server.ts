/** Termo de Recebimento e Conferência de Maleta — gerado só no servidor (pdf-lib). */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_LARDAN_PNG_BASE64 } from "@/lib/crm/dossie-logo";

export interface SnapshotTermo {
  termo_versao: string;
  termo_aprovado: boolean;
  modo: string;
  maleta: string;
  ciclo: number;
  consultora_nome: string | null;
  recebida_em: string | null;
  gerado_em: string;
  total_enviado: number;
  total_aceito: number;
  total_divergente: number;
  itens: {
    produto: string | null;
    sku: string | null;
    enviado: number;
    qty_accepted: number;
    qty_divergent: number;
    tipo_divergencia: string | null;
    motivo: string | null;
  }[];
}

/** RASCUNHO — texto pendente de revisão jurídica. Não usar em produção. */
const DECLARACAO = [
  "Declaro que recebi a maleta acima identificada e conferi, peça por peça, os itens nas",
  "quantidades discriminadas neste termo. Eventuais faltas ou defeitos constam expressamente",
  "na tabela abaixo, com a respectiva justificativa. A partir da assinatura, as peças aceitas",
  "ficam sob minha responsabilidade, nos termos do contrato de consultoria firmado com a Lardan.",
];

const dataBR = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

export async function gerarTermoPdf(s: SnapshotTermo, cpfCompleto: string, sha256: string) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Termo de recebimento ${s.maleta} ciclo ${s.ciclo}`);
  pdf.setProducer("Lardan");
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ouro = rgb(0.6, 0.47, 0.22);
  const cinza = rgb(0.35, 0.35, 0.35);
  let page = pdf.addPage([595, 842]);
  let y = 800;

  try {
    const logo = await pdf.embedPng(Uint8Array.from(atob(LOGO_LARDAN_PNG_BASE64), (c) => c.charCodeAt(0)));
    const w = 110;
    page.drawImage(logo, { x: 40, y: y - (w * logo.height) / logo.width + 10, width: w, height: (w * logo.height) / logo.width });
  } catch {
    page.drawText("LARDAN", { x: 40, y, size: 20, font: b, color: ouro });
  }
  y -= 50;
  page.drawText("TERMO DE RECEBIMENTO E CONFERÊNCIA DE MALETA LARDAN", { x: 40, y, size: 12.5, font: b });
  y -= 16;
  if (!s.termo_aprovado) {
    page.drawText("RASCUNHO — TEXTO PENDENTE DE REVISÃO JURÍDICA — SEM VALIDADE EM PRODUÇÃO", { x: 40, y, size: 8.5, font: b, color: rgb(0.7, 0.1, 0.1) });
    y -= 14;
  }
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.8, color: ouro });
  y -= 20;

  const campo = (rot: string, val: string) => {
    page.drawText(rot, { x: 40, y, size: 9, font: b, color: cinza });
    page.drawText(val, { x: 170, y, size: 9.5, font: f });
    y -= 14;
  };
  campo("Maleta", `${s.maleta} — ciclo ${s.ciclo}`);
  campo("Consultora", s.consultora_nome ?? "—");
  campo("CPF", cpfCompleto.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"));
  campo("Recebida em", dataBR(s.recebida_em));
  campo("Termo gerado em", dataBR(s.gerado_em));
  campo("Versão do termo", s.termo_versao);
  y -= 8;
  for (const l of DECLARACAO) {
    page.drawText(l, { x: 40, y, size: 9.5, font: f });
    y -= 13;
  }
  y -= 10;

  const cab = () => {
    page.drawRectangle({ x: 40, y: y - 4, width: 515, height: 16, color: rgb(0.96, 0.94, 0.89) });
    [["Peça", 44], ["SKU", 270], ["Enviadas", 350], ["Aceitas", 405], ["Divergentes", 455]].forEach(([t, x]) =>
      page.drawText(String(t), { x: Number(x), y, size: 8.5, font: b }),
    );
    y -= 18;
  };
  cab();
  for (const it of s.itens) {
    if (y < 110) {
      page = pdf.addPage([595, 842]);
      y = 800;
      cab();
    }
    page.drawText((it.produto ?? "—").slice(0, 48), { x: 44, y, size: 8.5, font: f });
    page.drawText((it.sku ?? "—").slice(0, 16), { x: 270, y, size: 8.5, font: f });
    page.drawText(String(it.enviado), { x: 360, y, size: 8.5, font: f });
    page.drawText(String(it.qty_accepted), { x: 415, y, size: 8.5, font: f });
    page.drawText(String(it.qty_divergent), { x: 470, y, size: 8.5, font: it.qty_divergent ? b : f });
    y -= 12;
    if (it.qty_divergent > 0) {
      page.drawText(`${it.tipo_divergencia === "defeito" ? "Defeito" : "Faltante"}: ${(it.motivo ?? "").slice(0, 90)}`, { x: 54, y, size: 8, font: f, color: cinza });
      y -= 12;
    }
  }
  y -= 6;
  page.drawText(`Totais — enviadas ${s.total_enviado} · aceitas ${s.total_aceito} · divergentes ${s.total_divergente}`, { x: 40, y, size: 9.5, font: b });

  // Rodapé com a impressão digital da conferência em todas as páginas.
  for (const p of pdf.getPages()) {
    p.drawText(`Impressão digital da conferência (SHA-256): ${sha256}`, { x: 40, y: 40, size: 6.5, font: f, color: cinza });
    p.drawText(`Ambiente: ${s.modo} · Assinatura eletrônica via Clicksign`, { x: 40, y: 30, size: 6.5, font: f, color: cinza });
  }
  return await pdf.save({ useObjectStreams: false });
}

export async function sha256Hex(bytes: Uint8Array) {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

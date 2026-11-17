/**
 * Nota promissória A4 da maleta (texto único para a montagem e para o representante na entrega em mãos).
 * Só monta o HTML; quem imprime decide a impressora.
 */
import { brl } from "@/lib/maletas";
import { valorPorExtenso } from "@/lib/remessa";

export interface DocConsultora {
  /** null na maleta de abertura (com o representante) */
  nome: string | null;
  abertura?: boolean;
  doc: string | null;
  rg: string | null;
  praca: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  cep: string | null;
  whatsapp: string | null;
  vencimento: string | null;
  remessa_numero?: number | null;
  remessa_emissao?: string | null;
  representante?: string | null;
}

function dataPorExtenso(d: Date) {
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

const CREDOR = "TSM COMÉRCIO DE SEMIJOIAS LTDA";
const CNPJ = "43.319.208/0001-80";
const PRACA_PAGAMENTO = "Ibiporã - PR";

export function htmlPromissoria(doc: DocConsultora, valorCents: number, codigoMaleta: string) {
  const hoje = new Date();
  const venc = doc.vencimento ? new Date(doc.vencimento) : new Date(hoje.getTime() + 10 * 864e5);
  const extenso = valorPorExtenso(valorCents);
  return `
  <h1>NOTA PROMISSÓRIA</h1>
  <h2>Referente à maleta ${codigoMaleta}</h2>
  <div class="caixa" style="position:relative">
    <p class="r" style="margin:0 0 10px;font-size:20px;font-weight:700">VENCIMENTO: ${venc.toLocaleDateString("pt-BR")}</p>
    <p class="valor r">${brl(valorCents)} &nbsp;·&nbsp; ${extenso}</p>
    <p>Em <strong>${dataPorExtenso(venc)}</strong> pagarei por esta única via de NOTA PROMISSÓRIA a
    <strong>${CREDOR}</strong> inscrita no CNPJ/MF sob nº <strong>${CNPJ}</strong>, ou a sua ordem,
    a quantia de <strong>(${extenso})</strong> em moeda corrente deste país.</p>
    <p>Pagável em <strong>${PRACA_PAGAMENTO}</strong>.</p>
    <p style="margin-top:18px">Emitente (DEVEDOR): <strong>${doc.nome ?? "________________________________________"}</strong></p>
    <p>Endereço: ${doc.endereco ?? "________________________"}${doc.bairro ? ` - ${doc.bairro}` : ""}</p>
    <p>Cidade/UF: ${doc.cidade ?? "__________"} &nbsp; CEP: ${doc.cep ?? "________"}</p>
    <p>CPF/MF: ${doc.doc ?? "____________________"}${doc.abertura ? " &nbsp; RG: ____________________ &nbsp; WhatsApp: ____________________" : ""}</p>
    <p class="r">IBIPORÃ/PR, ${dataPorExtenso(hoje)}</p>
    <div class="assinatura">Assinatura: ${doc.nome ?? ""}</div>
  </div>`;
}


/** Imprime HTML em A4 num quadro invisível (celular do representante: sem escolha de estação). */
export function imprimirA4(titulo: string, corpo: string): boolean {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  const d = frame.contentDocument, w = frame.contentWindow;
  if (!d || !w) { frame.remove(); return false; }
  d.open();
  d.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  @page{size:A4 portrait;margin:12mm}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px;font-size:13px}
  h1{font-size:18px;text-align:center;letter-spacing:.12em;margin:0 0 4px}
  h2{font-size:13px;text-align:center;margin:0 0 16px;font-weight:400}
  .caixa{border:1.5px solid #111;padding:14px 18px;margin-bottom:14px}
  .r{text-align:right}.c{text-align:center}
  .assinatura{margin-top:56px;border-top:1px solid #111;width:70%;margin-left:auto;margin-right:auto;text-align:center;padding-top:4px}
  .valor{font-size:16px;font-weight:700}
  @media print{body{margin:0}}
</style></head><body>${corpo}</body></html>`);
  d.close();
  w.addEventListener("afterprint", () => window.setTimeout(() => frame.remove(), 1000), { once: true });
  window.setTimeout(() => { w.focus(); w.print(); }, 150);
  return true;
}

/** Foto do celular reduzida (lado maior 1600 px, JPEG) para subir rápido no 4G. Devolve base64 sem prefixo. */
export async function fotoReduzida(arquivo: File): Promise<{ base64: string; tipo: string }> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
    const f = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    return { base64: cv.toDataURL("image/jpeg", 0.82).split(",")[1] ?? "", tipo: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

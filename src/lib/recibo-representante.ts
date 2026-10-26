/**
 * 0160 — Recibo do dinheiro recebido pelo representante (HTML puro, imprime em A4 ou meia folha).
 * Os dados vêm de rep_dinheiro_receber / rep_recibos_lista; nada de CPF completo (só mascarado).
 */
import type { Recibo } from "@/lib/representante";

const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, partes: string[] = [];
  if (c) partes.push(CENTENAS[c]!);
  if (r < 20) { if (r) partes.push(UNIDADES[r]!); }
  else { const d = Math.floor(r / 10), u = r % 10; partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]!); }
  return partes.join(" e ");
}
/** 12345 → "cento e vinte e três reais e quarenta e cinco centavos" */
export function valorPorExtenso(cents: number): string {
  const reais = Math.floor(cents / 100), cent = cents % 100;
  const mil = Math.floor(reais / 1000), resto = reais % 1000;
  const partesReais: string[] = [];
  if (mil) partesReais.push(mil === 1 ? "mil" : `${ate999(mil)} mil`);
  if (resto) partesReais.push(ate999(resto));
  let txt = "";
  if (reais) txt = `${partesReais.join(resto && (resto < 100 || resto % 100 === 0) ? " e " : " ")} ${reais === 1 ? "real" : "reais"}`;
  if (cent) txt += `${txt ? " e " : ""}${ate999(cent)} ${cent === 1 ? "centavo" : "centavos"}`;
  return txt || "zero real";
}

export function htmlRecibo(r: Recibo): string {
  const data = new Date(r.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
  const via = (rotulo: string) => `
  <section class="via">
    <header><div><p class="marca">LARDAN</p><p class="sub">Recibo de pagamento em dinheiro</p></div>
      <div class="num"><p>Nº ${r.numero}</p><p class="valor">${brl(r.valor_cents)}</p></div></header>
    <p class="texto">Recebi de <strong>${esc(r.consultora)}</strong>${r.code ? ` (código ${esc(r.code)})` : ""}${r.doc_masked ? `, CPF ${esc(r.doc_masked)}` : ""},
      a quantia de <strong>${brl(r.valor_cents)}</strong> (${esc(valorPorExtenso(r.valor_cents))}), referente a <strong>${esc(r.referente ?? "débito com a Lardan")}</strong>,
      em nome da LARDAN.</p>
    <p class="texto">Saldo que ainda fica em aberto nesta parcela: <strong>${brl(r.saldo_restante_cents)}</strong>.${r.observacao ? ` Observação: ${esc(r.observacao)}.` : ""}</p>
    <p class="data">${esc(data)}</p>
    <div class="assin"><span>${esc(r.representante)}<br/><small>Representante LARDAN</small></span><span>${esc(r.consultora)}<br/><small>Consultora</small></span></div>
    <p class="via-rot">${rotulo}</p>
  </section>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Recibo ${r.numero}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; } body { font-family: Georgia, "Times New Roman", serif; color: #1c1614; margin: 0; }
  .via { height: 132mm; border: 1px solid #b9a99a; border-radius: 4mm; padding: 9mm 11mm; display: flex; flex-direction: column; gap: 4mm; }
  .via + .via { margin-top: 8mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #d9cbbd; padding-bottom: 3mm; }
  .marca { font-size: 20pt; letter-spacing: .3em; margin: 0; } .sub { margin: 1mm 0 0; font-size: 9pt; color: #6b5b4e; }
  .num { text-align: right; } .num p { margin: 0; font-size: 10pt; } .num .valor { font-size: 17pt; font-weight: bold; }
  .texto { font-size: 11pt; line-height: 1.55; margin: 0; } .data { margin: 0; font-size: 10pt; color: #6b5b4e; }
  .assin { margin-top: auto; display: flex; gap: 12mm; } .assin span { flex: 1; border-top: 1px solid #1c1614; padding-top: 1.5mm; font-size: 10pt; text-align: center; }
  .via-rot { margin: 0; font-size: 8pt; color: #8a7a6c; text-align: right; }
</style></head><body>${via("Via da consultora")}${via("Via da Lardan")}</body></html>`;
}

export function textoReciboWhatsApp(r: Recibo): string {
  return `Recibo LARDAN nº ${r.numero}: recebi de ${r.consultora} ${brl(r.valor_cents)} em dinheiro, referente a ${r.referente ?? "débito com a Lardan"}. `
    + `Saldo em aberto nesta parcela: ${brl(r.saldo_restante_cents)}. — ${r.representante}, representante LARDAN.`;
}

export function imprimirRecibo(r: Recibo) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(frame);
  const d = frame.contentDocument, w = frame.contentWindow;
  if (!d || !w) { frame.remove(); return; }
  d.open(); d.write(htmlRecibo(r)); d.close();
  w.addEventListener("afterprint", () => window.setTimeout(() => frame.remove(), 1000), { once: true });
  window.setTimeout(() => { w.focus(); w.print(); }, 300);
}

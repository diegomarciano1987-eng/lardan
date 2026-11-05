/**
 * Imprime o DANFE enxuto (uma linha por peça) a partir do XML autorizado.
 * Usado no botão da maleta e na tela de notas. Sem janela extra: vai direto
 * para a impressão por um quadro invisível, como o pedido e a promissória.
 */
import { toast } from "sonner";
import { focusDanfeXml } from "@/lib/focus/focus.functions";
import { htmlDanfeCompacto, lerNfe } from "@/lib/danfe-compacto";

export async function imprimirDanfe(ref: string) {
  try {
    const { xml, cancelada } = await focusDanfeXml({ data: { ref } });
    const dados = { ...lerNfe(xml), cancelada };
    const html = htmlDanfeCompacto(dados);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    document.body.appendChild(frame);
    const d = frame.contentDocument, w = frame.contentWindow;
    if (!d || !w) { frame.remove(); toast.error("Não foi possível preparar a impressão."); return; }
    d.open(); d.write(html); d.close();
    await new Promise((r) => setTimeout(r, 250));
    w.focus(); w.print();
    setTimeout(() => frame.remove(), 60_000);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Não foi possível imprimir o DANFE.");
  }
}

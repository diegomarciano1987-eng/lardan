/**
 * Cobrança direta da Lardan à cliente da consultora (Pix, cartão por link, ou receber depois).
 * A consultora decide; o banco valida dono do pedido, CPF e valor. A cobrança sai pelo motor
 * oficial do Asaas em nome da Lardan e a baixa vem só pelo aviso do Asaas.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Forma = "pix" | "cartao" | "depois";
const BILLING: Record<Forma, "PIX" | "CREDIT_CARD" | "UNDEFINED"> = { pix: "PIX", cartao: "CREDIT_CARD", depois: "UNDEFINED" };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { rpc: (f: string, a: object) => PromiseLike<{ data: any; error: { message: string } | null }> };
}
async function rpcAdmin<T = any>(f: string, a: object): Promise<T> {
  const { data, error } = await (await admin()).rpc(f, a);
  if (error) throw new Error(error.message);
  return data as T;
}

export const consultoraCobrancaGerar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pedido: string; forma: Forma; cpf: string; vencimento?: string | null; parcelas?: number | null }) => {
    if (!d?.pedido || !["pix", "cartao", "depois"].includes(d.forma)) throw new Error("Dados inválidos.");
    // 0329: parcelas do cartão (1 a 12); só valem para cartão
    const parcelas = d.forma === "cartao" ? Math.trunc(Number(d.parcelas ?? 1)) : 1;
    if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > 12) throw new Error("Parcelas do cartão: de 1 a 12.");
    return { pedido: String(d.pedido).slice(0, 40), forma: d.forma, cpf: String(d.cpf ?? "").replace(/\D/g, "").slice(0, 11), vencimento: d.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento) ? d.vencimento : null, parcelas };
  })
  .handler(async ({ data, context }) => {
    // 27/11: a consultora pode trocar parcelas ou forma enquanto a cliente não pagou.
    // O link antigo é conferido e cancelado no Asaas (rotina oficial 0301) antes do novo.
    let trocada = false;
    const { data: tp, error: te } = await (context.supabase as any).rpc("consultora_cobranca_troca_preparar", { _order: data.pedido, _forma: data.forma, _parcelas: data.parcelas });
    if (te) throw new Error(te.message);
    const troca = tp as { precisa_trocar: boolean; actor?: string; cobrancas?: string[] };
    if (troca.precisa_trocar) {
      const { cancelarCobrancaComRegistro } = await import("./asaas/cancelar.server");
      for (const id of troca.cobrancas ?? []) {
        const r = await cancelarCobrancaComRegistro(id, troca.actor!, "Consultora gerou novo link (troca de forma ou parcelas)");
        if (r.resultado === "paga_no_asaas") throw new Error("A cliente já pagou este link. A venda será baixada sozinha.");
        if (r.resultado === "falhou") throw new Error(`Não consegui cancelar o link anterior no Asaas: ${r.erro ?? "tente de novo"}`);
      }
      const { error: ce } = await (context.supabase as any).rpc("consultora_cobranca_troca_concluir", { _order: data.pedido, _forma: data.forma });
      if (ce) throw new Error(ce.message);
      trocada = true;
    }
    const { data: t, error } = await (context.supabase as any).rpc("consultora_pagamento_titulo", { _order: data.pedido, _forma: data.forma, _doc: data.cpf, _venc: data.vencimento });
    if (error) throw new Error(error.message);
    const tt = t as { installment_id: string; actor: string; forma: Forma; vencimento: string };
    const { solicitarCobranca } = await import("./asaas/operacoes");
    const { bancoExecutor } = await import("./asaas/servidor.server");
    const { envDoServidor } = await import("./asaas/configuracao.server");
    const executor = await bancoExecutor();
    const usuario = { rpc: <T,>(_f: string, a: Record<string, unknown>) => rpcAdmin<T>("consultora_asaas_preparar", { _actor: tt.actor, _payload: a["_payload"] }) };
    const r = await solicitarCobranca(usuario as never, executor, tt.actor, { installmentId: tt.installment_id, billingType: BILLING[tt.forma], dueDate: tt.vencimento, ...(tt.forma === "cartao" ? { parcelasCartao: data.parcelas } : {}) }, { env: envDoServidor() });
    if ((r as { state: string }).state === "indisponivel") throw new Error((r as { aviso?: string }).aviso || "Cobrança indisponível no momento.");
    const rr = r as { charge_id?: string | null; invoice_url?: string | null; external_id?: string | null; simulado?: boolean };
    await rpcAdmin("consultora_pagamento_registrar", { _order: data.pedido, _charge: rr.charge_id ?? null, _url: rr.invoice_url ?? null });
    let copia: string | null = null; let qr: string | null = null;
    if (tt.forma === "pix" && rr.external_id && !rr.simulado) {
      try {
        const { resolverPorParcela } = await import("./asaas/servidor.server");
        const { transporteDaResolucao } = await import("./asaas/configuracao.server");
        const tr = (await transporteDaResolucao(await resolverPorParcela(tt.installment_id, tt.actor))) as unknown as { pixQrCode?: (id: string) => Promise<{ payload: string | null; encodedImage: string | null }> };
        const px = await tr.pixQrCode?.(rr.external_id);
        copia = px?.payload ?? null; qr = px?.encodedImage ? `data:image/png;base64,${px.encodedImage}` : null;
      } catch (e) { console.error("pix qrcode consultora", (e as Error).message); }
    }
    return { forma: tt.forma, vencimento: tt.vencimento, url: rr.invoice_url ?? null, copia, qr, parcelas: tt.forma === "cartao" ? data.parcelas : 1, trocada };
  });

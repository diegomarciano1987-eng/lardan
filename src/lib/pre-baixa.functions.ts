/**
 * 0158 — fecha a pré-baixa e gera o Pix da Lardan com o valor exato do acerto (QR dinâmico do Asaas).
 * O banco valida a dona da maleta e calcula o valor; a baixa vem só pelo aviso do Asaas.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function rpcAdmin<T = any>(f: string, a: object): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).rpc(f, a);
  if (error) throw new Error(error.message);
  return data as T;
}

export const preBaixaFecharPix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycle: string }) => {
    if (!d?.cycle || !/^[0-9a-f-]{36}$/.test(d.cycle)) throw new Error("Maleta inválida.");
    return { cycle: d.cycle };
  })
  .handler(async ({ data, context }) => {
    const { data: f, error } = await (context.supabase as any).rpc("pre_baixa_fechar", { _cycle: data.cycle });
    if (error) throw new Error(error.message);
    const r = f as { installment_id: string | null; actor: string; valor_pagar_cents: number; vencimento: string };
    if (!r.installment_id || Number(r.valor_pagar_cents) <= 0) return { valor_cents: 0, copia: null, qr: null, url: null };
    const { solicitarCobranca } = await import("./asaas/operacoes");
    const { bancoExecutor } = await import("./asaas/servidor.server");
    const { envDoServidor } = await import("./asaas/configuracao.server");
    const executor = await bancoExecutor();
    const usuario = { rpc: <T,>(_f: string, a: Record<string, unknown>) => rpcAdmin<T>("pre_baixa_asaas_preparar", { _actor: r.actor, _payload: a["_payload"] }) };
    const c = await solicitarCobranca(usuario as never, executor, r.actor, { installmentId: r.installment_id, billingType: "PIX", dueDate: r.vencimento }, { env: envDoServidor() });
    if ((c as { state: string }).state === "indisponivel") throw new Error((c as { aviso?: string }).aviso || "Pix indisponível no momento. Tente de novo.");
    const cc = c as { invoice_url?: string | null; external_id?: string | null; simulado?: boolean };
    let copia: string | null = null; let qr: string | null = null;
    if (cc.external_id && !cc.simulado) {
      try {
        const { resolverPorParcela } = await import("./asaas/servidor.server");
        const { transporteDaResolucao } = await import("./asaas/configuracao.server");
        const tr = (await transporteDaResolucao(await resolverPorParcela(r.installment_id, r.actor))) as unknown as { pixQrCode?: (id: string) => Promise<{ payload: string | null; encodedImage: string | null }> };
        const px = await tr.pixQrCode?.(cc.external_id);
        copia = px?.payload ?? null; qr = px?.encodedImage ? `data:image/png;base64,${px.encodedImage}` : null;
      } catch (e) { console.error("pix pré-baixa", (e as Error).message); }
    }
    return { valor_cents: Number(r.valor_pagar_cents), copia, qr, url: cc.invoice_url ?? null };
  });

/**
 * Ações de cobrança chamadas pela tela. O usuário só SOLICITA; o executor
 * interno grava o resultado. O transporte é escolhido pela configuração do
 * servidor — ausente ou inválida, a integração fica indisponível.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: never; userId: string };

export const gerarLinkCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; installmentId: string; billingType: "PIX" | "BOLETO" | "UNDEFINED" }) => {
    if (!d?.accountId || !d?.installmentId) throw new Error("Conta e parcela são obrigatórias.");
    if (!["PIX", "BOLETO", "UNDEFINED"].includes(d.billingType)) throw new Error("Forma de pagamento inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { criarTransporte } = await import("./index");
    const { gerarLinkDeCobranca } = await import("./cobranca");
    const { bancoDe, bancoExecutor } = await import("./servidor.server");
    const transporte = await criarTransporte(data.accountId);
    return gerarLinkDeCobranca(bancoDe(c.supabase), await bancoExecutor(), transporte,
      { accountId: data.accountId, installmentId: data.installmentId, billingType: data.billingType },
      { actor: c.userId });
  });

export const recuperarIntencao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { intentId: string }) => {
    if (!d?.intentId) throw new Error("Intenção obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as { userId: string; supabase: { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: { account_id: string } | null }> } } } } };
    const { data: it } = await c.supabase.from("asaas_charge_intents").select("account_id").eq("id", data.intentId).maybeSingle();
    if (!it) throw new Error("Intenção não encontrada ou sem acesso.");
    const { criarTransporte } = await import("./index");
    const { executarIntencao } = await import("./cobranca");
    const { bancoExecutor } = await import("./servidor.server");
    return executarIntencao(await bancoExecutor(), await criarTransporte(it.account_id), data.intentId, { actor: c.userId });
  });

export const obterLinkDaCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chargeId: string; accountId: string }) => {
    if (!d?.chargeId || !d?.accountId) throw new Error("Cobrança obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { criarTransporte } = await import("./index");
    const { obterLinkCobranca } = await import("./cobranca");
    const { bancoExecutor } = await import("./servidor.server");
    return obterLinkCobranca(await bancoExecutor(), await criarTransporte(data.accountId), data.chargeId, c.userId);
  });

export const estadoIntegracao = createServerFn({ method: "GET" }).handler(async () => {
  const { configuracaoDoServidor } = await import("./index");
  const cfg = configuracaoDoServidor();
  return cfg.disponivel
    ? { disponivel: true as const, modo: cfg.modo, ambiente: cfg.ambiente, demo: cfg.demoIsolado }
    : { disponivel: false as const, motivo: cfg.motivo };
});

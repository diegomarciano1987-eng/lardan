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
  .inputValidator((d: { installmentId: string; billingType: "PIX" | "BOLETO" | "UNDEFINED" }) => {
    if (!d?.installmentId) throw new Error("Parcela obrigatória.");
    if (!["PIX", "BOLETO", "UNDEFINED"].includes(d.billingType)) throw new Error("Forma de pagamento inválida.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { prepararIntencao, executarIntencao } = await import("./cobranca");
    const { bancoDe, transporteDaIntencao } = await import("./servidor.server");
    const it = await prepararIntencao(bancoDe(c.supabase), data);
    if (it.reaproveitada) return { ...it, state: "criada" };
    if (!it.id) throw new Error("Intenção não registrada.");
    const resolvida = await transporteDaIntencao(it.id, c.userId);
    return executarIntencao(resolvida.executor, resolvida.transporte, it.id, { actor: c.userId });
  });

export const recuperarIntencao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { intentId: string }) => {
    if (!d?.intentId) throw new Error("Intenção obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { executarIntencao } = await import("./cobranca");
    const { transporteDaIntencao } = await import("./servidor.server");
    const resolvida = await transporteDaIntencao(data.intentId, c.userId);
    return executarIntencao(resolvida.executor, resolvida.transporte, data.intentId, { actor: c.userId });
  });

export const obterLinkDaCobranca = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chargeId: string }) => {
    if (!d?.chargeId) throw new Error("Cobrança obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { obterLinkCobranca } = await import("./cobranca");
    const { transporteDaCobranca } = await import("./servidor.server");
    const resolvida = await transporteDaCobranca(data.chargeId, c.userId);
    return obterLinkCobranca(resolvida.executor, resolvida.transporte, data.chargeId, c.userId);
  });

export const estadoIntegracao = createServerFn({ method: "GET" }).handler(async () => {
  const { configuracaoDoServidor } = await import("./index");
  const cfg = configuracaoDoServidor();
  return cfg.disponivel
    ? { disponivel: true as const, modo: cfg.modo, ambiente: cfg.ambiente, demo: cfg.demoIsolado,
        redeHabilitada: cfg.modo === "conectado" ? cfg.redeHabilitada : false }
    : { disponivel: false as const, motivo: cfg.motivo };
});

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
    const { solicitarCobranca } = await import("./operacoes");
    const { bancoDe, bancoExecutor } = await import("./servidor.server");
    const { envDoServidor } = await import("./configuracao.server");
    // Preflight ANTES de qualquer efeito: sem intenção, tentativa ou alteração.
    return solicitarCobranca(bancoDe(c.supabase), await bancoExecutor(), c.userId, data, { env: envDoServidor() });
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

/** Estado sanitizado por conta — mesma resolução usada pelas operações. */
export const estadoContasAsaas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const c = context as unknown as Ctx;
    const { bancoDe, contasResolvidas } = await import("./servidor.server");
    const { publico } = await import("./configuracao.server");
    const pode = await bancoDe(c.supabase).rpc<boolean>("has_capability", { _user_id: c.userId, _cap: "finance.receivable.view" });
    if (!pode) throw new Error("Sem permissão.");
    return (await contasResolvidas(c.userId)).map((x) => publico(x.r, x.id, x.nome));
  });

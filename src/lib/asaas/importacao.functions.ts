import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: never; userId: string };

/** Fluxo comum: conta escolhida abre o lote; depois conta e transporte vêm do próprio lote. */
export const importarRecebiveis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { accountId: string; maxPaginas?: number }) => {
    if (!d?.accountId) throw new Error("Conta obrigatória.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const { abrirLote, buscarPaginas, gerarPrevia } = await import("./importacao");
    const { bancoDe, bancoExecutor, transporteDaConfiguracao } = await import("./servidor.server");
    const { ROTINAS_EXECUTOR } = await import("./banco");
    const usuario = bancoDe(c.supabase);
    const pedido = { accountId: data.accountId, pageSize: 50, incluirEmAbertoAnteriores: true,
      ...(data.maxPaginas ? { maxPaginas: data.maxPaginas } : {}) };
    const lote = await abrirLote(usuario, pedido);
    const executor = await bancoExecutor();
    const config = await executor.rpc<Parameters<typeof transporteDaConfiguracao>[0]>(ROTINAS_EXECUTOR.configLote,
      { _run: lote.run_id, _actor: c.userId });
    const busca = await buscarPaginas(usuario, await transporteDaConfiguracao(config), lote, pedido);
    return { lote, busca, previa: busca.hasMore ? null : await gerarPrevia(usuario, lote.run_id) };
  });
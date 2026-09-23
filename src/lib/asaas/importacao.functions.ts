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
    const { importarComPreflight } = await import("./operacoes");
    const { bancoDe, bancoExecutor } = await import("./servidor.server");
    const { envDoServidor } = await import("./configuracao.server");
    // Preflight ANTES de abrir lote: conta, segredo, ambiente e gate.
    return importarComPreflight(bancoDe(c.supabase), await bancoExecutor(), c.userId,
      { accountId: data.accountId, ...(data.maxPaginas ? { maxPaginas: data.maxPaginas } : {}) }, { env: envDoServidor() });
  });

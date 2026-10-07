import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Espelha as cobranças existentes no Asaas, concilia por CPF/valor/vencimento (casamento único)
 * e baixa as recebidas pelo motor oficial. Idempotente.
 */
export const sincronizarCobrancasAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { de: string; ate: string }) => {
    if (!DATA.test(i.de) || !DATA.test(i.ate) || i.de > i.ate) throw new Error("Período inválido.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: pode } = await context.supabase.rpc("has_capability", {
      _user_id: context.userId,
      _cap: "finance.receivable.view",
    } as never);
    if (!pode) throw new Error("Sem permissão.");
    const { executarSyncAsaas } = await import("./espelho.server");
    return executarSyncAsaas({ actor: context.userId, de: data.de, ate: data.ate });
  });

/**
 * 0402 — Painel de configuração da Lara (só Master): quais segredos já estão no Lovable (nunca os valores),
 * situação do número e dos modelos na Meta, ativar o número e mandar os modelos para aprovação.
 * Ligar/desligar é pela RPC lara_ligar (Master, auditado).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }; userId: string };

async function exigirMaster(context: unknown) {
  const c = context as Ctx;
  const r = await c.supabase.rpc("has_role", { _user_id: c.userId, _role: "master" });
  if (r.error || r.data !== true) throw new Error("Só o Master configura a Lara.");
}

export type PainelLara = {
  segredos: Record<string, boolean>;
  numero: import("./meta.server").StatusNumero | null;
  modelos: import("./meta.server").StatusModelo[];
  erro: string | null;
};

export const laraPainel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PainelLara> => {
    await exigirMaster(context);
    const meta = await import("./meta.server");
    const segredos = meta.segredosPresentes();
    if (!segredos.WHATSAPP_TOKEN || !segredos.WHATSAPP_PHONE_NUMBER_ID || !segredos.WHATSAPP_WABA_ID) return { segredos, numero: null, modelos: [], erro: null };
    try {
      const [numero, modelos] = await Promise.all([meta.statusNumero(), meta.listarModelos()]);
      return { segredos, numero, modelos, erro: null };
    } catch (e) {
      return { segredos, numero: null, modelos: [], erro: (e as Error).message };
    }
  });

export const laraAtivarNumero = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirMaster(context);
    const meta = await import("./meta.server");
    return meta.ativarNumero();
  });

export const laraEnviarModelos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirMaster(context);
    const meta = await import("./meta.server");
    return meta.enviarModelosParaAprovacao();
  });

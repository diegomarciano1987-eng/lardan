/** 0376: traz para o espelho uma cobrança recebida que o extrato já mostra (só leitura no Asaas). */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export const trazerCobrancaAoEspelho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { paymentId: string }) => {
    if (!/^pay_[A-Za-z0-9]{6,40}$/.test(d?.paymentId ?? "")) throw new Error("Código da cobrança inválido.");
    return { paymentId: d.paymentId };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as { supabase: { rpc: Rpc } };
    const pode = await c.supabase.rpc("asaas_eu_posso", { _cap: "finance.reconcile" });
    if (pode.error || !pode.data) throw new Error("Sem acesso à conciliação.");
    const { releCobrancasProducao } = await import("./espelho.server");
    const [r] = await releCobrancasProducao([data.paymentId]);
    return { status: r?.status ?? null };
  });

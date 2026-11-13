/**
 * 0306 — botão da ficha: "Atualizar cadastro no Asaas" (confere agora) e "Usar o do Lardan" (força os pontos para conferir).
 * A permissão é conferida no banco com a sessão de quem clicou (asaas_cliente_espelho_solicitar).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export const espelharClienteAgora = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partyId: string; forcar?: boolean }) => {
    if (!UUID.test(d?.partyId ?? "")) throw new Error("Cliente inválida.");
    return { partyId: d.partyId, forcar: d.forcar === true };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as { supabase: { rpc: Rpc }; userId: string };
    const { data: n, error } = await c.supabase.rpc("asaas_cliente_espelho_solicitar", { _party: data.partyId, _forcar: data.forcar });
    if (error) throw new Error(error.message);
    if (!Number(n)) return { semCadastro: true, processadas: 0, atualizadas: 0, iguais: 0, diferentes: 0, erros: 0 };
    const { espelharClientesProducao } = await import("./cliente-espelho.server");
    const r = await espelharClientesProducao({ party: data.partyId, limite: 10, actor: c.userId });
    return { semCadastro: false, processadas: r.processadas, atualizadas: r.atualizadas, iguais: r.iguais, diferentes: r.diferentes, erros: r.erros };
  });

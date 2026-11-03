/** Cancelamento de cobranças no Asaas (somente servidor). */
import { transporteDaCobranca } from "./servidor.server";

export async function cancelarNoAsaas(chargeId: string, externalId: string, actor: string): Promise<{ ok: boolean; erro: string | null }> {
  try {
    const { transporte } = await transporteDaCobranca(chargeId, actor);
    if (!transporte.cancelarCobranca) return { ok: false, erro: "Conta simulada: cancelamento no Asaas indisponível." };
    await transporte.cancelarCobranca(externalId);
    return { ok: true, erro: null };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

/** Acordos aguardando 1º pagamento vencidos há mais de 5 dias: cancela cobranças, encerra e avisa quem fez o acordo. */
export async function encerrarAcordosVencidos(actor: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc as unknown as (f: string, a?: object) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("cob_acordo_vencidos_listar");
  if (error) throw new Error(error.message);
  const porSim = new Map<string, { charge_id: string | null; external_id: string | null }[]>();
  for (const l of (data ?? []) as { simulacao_id: string; charge_id: string | null; external_id: string | null }[]) {
    porSim.set(l.simulacao_id, [...(porSim.get(l.simulacao_id) ?? []), l]);
  }
  const resultado: { simulacao: string; ok: boolean; canceladas: number; falhas: string[] }[] = [];
  for (const [sim, linhas] of porSim) {
    const canceladas: string[] = [];
    const falhas: string[] = [];
    for (const l of linhas) {
      if (!l.charge_id || !l.external_id) continue;
      const r = await cancelarNoAsaas(l.charge_id, l.external_id, actor);
      if (r.ok) canceladas.push(l.charge_id); else falhas.push(`${l.external_id}: ${r.erro}`);
    }
    const e = await rpc("cob_acordo_vencido_encerrar", { _sim: sim, _canceladas: canceladas, _falhas: falhas });
    if (e.error) falhas.push(e.error.message);
    resultado.push({ simulacao: sim, ok: falhas.length === 0, canceladas: canceladas.length, falhas });
  }
  return resultado;
}

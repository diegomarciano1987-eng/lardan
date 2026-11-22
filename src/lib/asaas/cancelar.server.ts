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

const PAGAS_CANC = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const ABERTAS_CANC = new Set(["PENDING", "OVERDUE"]);

export type ResultadoCancelamentoRegistrado = {
  external_id: string | null;
  resultado: "cancelada" | "ja_excluida" | "paga_no_asaas" | "falhou";
  status: string | null;
  erro: string | null;
};

/**
 * 22/11: mesmo caminho do "Cancelar no Asaas" (0301) para uso de outras ações do servidor (ex.: liquidar dívida).
 * Confere no Asaas antes (paga nunca é excluída) e registra a tentativa com motivo e quem fez.
 */
export async function cancelarCobrancaComRegistro(chargeId: string, actor: string, motivo: string): Promise<ResultadoCancelamentoRegistrado> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rpc = supabaseAdmin.rpc as unknown as (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const prep = await rpc("asaas_cobranca_cancelar_preparar", { _charge: chargeId, _actor: actor });
  if (prep.error) return { external_id: null, resultado: "falhou", status: null, erro: prep.error.message };
  const { external_id } = prep.data as { external_id: string };
  let r: Omit<ResultadoCancelamentoRegistrado, "external_id">;
  try {
    const { transporte } = await transporteDaCobranca(chargeId, actor);
    const remoto = await transporte.consultarCobranca(external_id);
    if (!remoto || remoto.status === "DELETED") r = { resultado: "ja_excluida", status: remoto?.status ?? null, erro: null };
    else if (PAGAS_CANC.has(remoto.status)) r = { resultado: "paga_no_asaas", status: remoto.status, erro: null };
    else if (!ABERTAS_CANC.has(remoto.status)) r = { resultado: "falhou", status: remoto.status, erro: `Situação no Asaas: ${remoto.status}` };
    else if (!transporte.cancelarCobranca) r = { resultado: "falhou", status: remoto.status, erro: "Esta conta não permite cancelar pelo sistema." };
    else {
      await transporte.cancelarCobranca(external_id);
      r = { resultado: "cancelada", status: remoto.status, erro: null };
    }
  } catch (e) {
    r = { resultado: "falhou", status: null, erro: (e instanceof Error ? e.message : String(e)).replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 400) };
  }
  const reg = await rpc("asaas_cobranca_cancelar_registrar", {
    _charge: chargeId, _actor: actor, _motivo: motivo, _resultado: r.resultado, _status_remoto: r.status, _erro: r.erro,
  });
  if (reg.error) return { external_id, ...r, erro: r.erro ?? reg.error.message };
  return { external_id, ...r };
}

/**
 * Cancelar no Asaas uma cobrança lançada errado (ex.: vencimento errado), pela ficha "Cobrar pelo Asaas".
 * Sempre confere no Asaas antes: cobrança paga nunca é excluída. O resultado fica registrado com motivo e quem fez.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };

const PAGAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const ABERTAS = new Set(["PENDING", "OVERDUE"]);
const limpa = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 400);

export type ResultadoCancelamento = {
  resultado: "cancelada" | "ja_excluida" | "paga_no_asaas" | "falhou";
  status: string | null;
  erro: string | null;
};

export const cancelarCobrancaAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chargeId: string; motivo: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.chargeId ?? "")) throw new Error("Cobrança inválida.");
    if ((d.motivo ?? "").trim().length < 5) throw new Error("Escreva o motivo do cancelamento (mínimo 5 letras).");
    return { chargeId: d.chargeId, motivo: d.motivo.trim().slice(0, 300) };
  })
  .handler(async ({ data, context }): Promise<ResultadoCancelamento> => {
    const c = context as unknown as Ctx;
    // permissão conferida com a sessão da própria pessoa
    const pode = await c.supabase.rpc("asaas_ator_pode", { _actor: c.userId, _cap: "finance.receivable.manage" });
    if (pode.error || !pode.data) throw new Error("Sem acesso ao financeiro para cancelar cobrança.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rpc = supabaseAdmin.rpc as unknown as Rpc;
    const prep = await rpc("asaas_cobranca_cancelar_preparar", { _charge: data.chargeId, _actor: c.userId });
    if (prep.error) throw new Error(prep.error.message);
    const { external_id } = prep.data as { external_id: string };

    let r: ResultadoCancelamento;
    try {
      const { transporteDaCobranca } = await import("./servidor.server");
      const { transporte } = await transporteDaCobranca(data.chargeId, c.userId);
      const remoto = await transporte.consultarCobranca(external_id);
      if (!remoto || remoto.status === "DELETED") r = { resultado: "ja_excluida", status: remoto?.status ?? null, erro: null };
      else if (PAGAS.has(remoto.status)) r = { resultado: "paga_no_asaas", status: remoto.status, erro: null };
      else if (!ABERTAS.has(remoto.status)) r = { resultado: "falhou", status: remoto.status, erro: `Situação no Asaas: ${remoto.status}` };
      else if (!transporte.cancelarCobranca) r = { resultado: "falhou", status: remoto.status, erro: "Esta conta não permite cancelar pelo sistema." };
      else {
        await transporte.cancelarCobranca(external_id);
        r = { resultado: "cancelada", status: remoto.status, erro: null };
      }
    } catch (e) {
      r = { resultado: "falhou", status: null, erro: limpa(e) };
    }

    const reg = await rpc("asaas_cobranca_cancelar_registrar", {
      _charge: data.chargeId, _actor: c.userId, _motivo: data.motivo,
      _resultado: r.resultado, _status_remoto: r.status, _erro: r.erro,
    });
    if (reg.error) throw new Error(reg.error.message);
    return r;
  });

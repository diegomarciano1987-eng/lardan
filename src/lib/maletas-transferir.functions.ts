/**
 * 0279 — transferir a maleta de uma consultora para outra (equipe ou representante).
 * O banco faz a troca inteira numa transação só (e diz o que travou). Depois, aqui no servidor:
 * recusa na ZapSign a promissória pendente da anterior e envia a promissória da nova
 * quando a anterior tinha uma. Se a ZapSign falhar, a troca já valeu e a recusa fica na fila.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface PedidoTransferencia {
  cycleId: string;
  /** "equipe" = Daniel/Master/montagem; "representante" = app do representante */
  modo: "equipe" | "representante";
  consultoraId?: string | null;
  leadId?: string | null;
  rep?: string | null;
  motivo?: string | null;
}

export interface ResultadoTransferencia {
  consultora_party_id: string | null;
  consultora_nova: string | null;
  consultora_anterior: string | null;
  nova_consultora: boolean;
  abertura_numero: number | null;
  pendencia_fiscal: boolean;
  nota_numero: string | null;
  entregas_canceladas: number;
  voltou_do_recebimento: boolean;
  promissoria: { antiga_recusada: number; antiga_pendente_fila: number; nova: "enviada" | "ja_existia" | "nao_precisa" | "falhou"; aviso?: string; signUrl?: string | null };
}

export const maletaTransferir = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PedidoTransferencia) => {
    if (!UUID.test(d?.cycleId ?? "")) throw new Error("Maleta inválida.");
    if (d.modo !== "equipe" && d.modo !== "representante") throw new Error("Modo inválido.");
    if (d.consultoraId && !UUID.test(d.consultoraId)) throw new Error("Consultora inválida.");
    if (d.leadId && !UUID.test(d.leadId)) throw new Error("Candidata inválida.");
    if (d.modo === "representante" && !UUID.test(d.rep ?? "")) throw new Error("Representante inválido.");
    if (d.modo === "representante" && !d.consultoraId === !d.leadId) throw new Error("Escolha uma consultora ou uma candidata.");
    if (d.modo === "equipe" && d.leadId) throw new Error("A equipe transfere para uma consultora ou deixa como abertura.");
    return {
      cycleId: d.cycleId, modo: d.modo, consultoraId: d.consultoraId ?? null, leadId: d.leadId ?? null,
      rep: d.rep ?? null, motivo: (d.motivo ?? "").trim().slice(0, 500),
    };
  })
  .handler(async ({ data, context }): Promise<ResultadoTransferencia> => {
    const c = context as unknown as { supabase: { rpc: Rpc }; userId: string };
    const chamada = data.modo === "equipe"
      ? c.supabase.rpc("remessa_maleta_transferir", { _cycle: data.cycleId, _consultora: data.consultoraId, _motivo: data.motivo })
      : c.supabase.rpc("rep_maleta_trocar_destino", { _rep: data.rep, _cycle: data.cycleId, _consultora: data.consultoraId, _lead: data.leadId });
    const { data: bruto, error } = await chamada;
    if (error) throw new Error(error.message);
    const r = (bruto ?? {}) as Record<string, unknown>;

    const tokens = Array.isArray(r["zapsign_cancelar"]) ? (r["zapsign_cancelar"] as string[]) : [];
    const promissoria: ResultadoTransferencia["promissoria"] = { antiga_recusada: 0, antiga_pendente_fila: 0, nova: "nao_precisa" };
    if (tokens.length) {
      const { recusarNaZapsign } = await import("@/lib/zapsign/enviar.server");
      const x = await recusarNaZapsign(tokens).catch(() => ({ recusados: 0, finais: 0, falhas: tokens.length }));
      promissoria.antiga_recusada = x.recusados + x.finais;
      promissoria.antiga_pendente_fila = x.falhas;
    }
    const nova = (r["consultora_party_id"] as string | null) ?? null;
    if (r["tinha_promissoria"] === true && nova) {
      try {
        const { enviarAssinatura } = await import("@/lib/zapsign/enviar.server");
        const e = await enviarAssinatura(c, { tipo: "promissoria", partyId: nova, cycleId: data.cycleId, rep: data.modo === "representante" ? data.rep : null });
        promissoria.nova = e.jaExistia ? "ja_existia" : "enviada";
        promissoria.signUrl = e.signUrl;
      } catch (e) {
        promissoria.nova = "falhou";
        promissoria.aviso = (e as Error).message;
      }
    }
    return {
      consultora_party_id: nova,
      consultora_nova: (r["consultora_nova"] as string | null) ?? null,
      consultora_anterior: (r["consultora_anterior"] as string | null) ?? null,
      nova_consultora: r["nova_consultora"] === true,
      abertura_numero: (r["abertura_numero"] as number | null) ?? null,
      pendencia_fiscal: r["pendencia_fiscal"] === true,
      nota_numero: (r["nota_numero"] as string | null) ?? null,
      entregas_canceladas: Number(r["entregas_canceladas"] ?? 0),
      voltou_do_recebimento: r["voltou_do_recebimento"] === true,
      promissoria,
    };
  });

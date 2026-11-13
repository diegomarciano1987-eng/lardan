/**
 * 0315 — desfazer movimento errado de maleta (equipe e representante).
 * O banco faz tudo numa transação (maleta_movimento_desfazer); aqui só recusamos na ZapSign
 * a promissória pendente da consultora errada e reenviamos a promissória para quem volta a ter a maleta.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export interface ResultadoDesfazer {
  maleta: string | null;
  de: string | null;
  para: string | null;
  aceite_desfeito: boolean;
  carteira_voltou: boolean;
  promissoria: { antiga_recusada: number; antiga_pendente_fila: number; nova: "nao_precisa" | "enviada" | "ja_existia" | "falhou"; aviso?: string };
}

export const maletaDesfazerMovimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventoId: string; cycleId: string; motivo: string; rep?: string | null }) => {
    if (!UUID.test(d?.eventoId ?? "")) throw new Error("Movimento inválido.");
    if (!UUID.test(d?.cycleId ?? "")) throw new Error("Maleta inválida.");
    if (d.rep && !UUID.test(d.rep)) throw new Error("Representante inválido.");
    const motivo = (d.motivo ?? "").trim();
    if (motivo.length < 10) throw new Error("Escreva o motivo de desfazer (mínimo 10 letras).");
    return { eventoId: d.eventoId, cycleId: d.cycleId, motivo: motivo.slice(0, 500), rep: d.rep ?? null };
  })
  .handler(async ({ data, context }): Promise<ResultadoDesfazer> => {
    const c = context as unknown as { supabase: { rpc: Rpc }; userId: string };
    const { data: bruto, error } = await c.supabase.rpc("maleta_movimento_desfazer", { _evento: data.eventoId, _motivo: data.motivo, _rep: data.rep });
    if (error) throw new Error(error.message);
    const r = (bruto ?? {}) as Record<string, unknown>;
    const promissoria: ResultadoDesfazer["promissoria"] = { antiga_recusada: 0, antiga_pendente_fila: 0, nova: "nao_precisa" };
    const tokens = Array.isArray(r["zapsign_cancelar"]) ? (r["zapsign_cancelar"] as string[]) : [];
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
        const e = await enviarAssinatura(c, { tipo: "promissoria", partyId: nova, cycleId: data.cycleId, rep: data.rep });
        promissoria.nova = e.jaExistia ? "ja_existia" : "enviada";
      } catch (e) {
        promissoria.nova = "falhou";
        promissoria.aviso = (e as Error).message;
      }
    }
    return {
      maleta: (r["maleta"] as string | null) ?? null,
      de: (r["de"] as string | null) ?? null,
      para: (r["para"] as string | null) ?? null,
      aceite_desfeito: r["aceite_desfeito"] === true,
      carteira_voltou: r["carteira_voltou"] === true,
      promissoria,
    };
  });

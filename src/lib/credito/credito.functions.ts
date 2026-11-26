/**
 * 0394 — Consulta de crédito da candidata (Assertiva) e data de nascimento.
 * Quem consulta: equipe com candidaturas.edit. O banco decide se pode (CPF, reaproveitamento de 30 dias, limite diário)
 * e aplica a regra por idade. A chave da API nunca sai do servidor.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Admin = { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin;

export type ResultadoCredito = {
  id: string; situacao: "ok" | "cpf_nao_encontrado" | "sem_score" | "erro"; resultado: "aprovada_regra" | "revisar";
  motivo: string; score: number | null; idade: number | null; score_minimo: number | null;
};

/** Usado pela tela (manual) e, depois, pelo robô de WhatsApp (automática, sem usuário). */
export async function consultarCreditoDaCandidata(lead: string, origem: "manual" | "automatica", usuario: string | null, forcar = false) {
  const sb = await admin();
  const prep = await sb.rpc("candidatura_credito_preparar", { _lead: lead, _forcar: forcar, _usuario: usuario });
  if (prep.error) throw new Error(prep.error.message);
  const p = prep.data as { pode: boolean; motivo?: string; cpf?: string; reaproveitar?: boolean };
  if (!p.pode) {
    if (p.reaproveitar) return { reaproveitada: true as const, motivo: p.motivo ?? "" };
    throw new Error(p.motivo ?? "Não foi possível consultar.");
  }
  const { consultarCreditoPF, ErroAssertiva } = await import("./assertiva.server");
  let http = 0;
  let corpo: Record<string, unknown> = {};
  try {
    ({ http, corpo } = await consultarCreditoPF(p.cpf!));
  } catch (e) {
    // chave ausente/recusada, sem permissão ou consulta repetida (429): nada foi cobrado; avisa a equipe sem gravar
    if (e instanceof ErroAssertiva) throw new Error(e.message);
    http = 0; // rede ou tempo esgotado: grava como "erro" para ficar no histórico
  }
  const reg = await sb.rpc("candidatura_credito_registrar", { _lead: lead, _http: http, _resposta: corpo, _origem: origem, _usuario: usuario });
  if (reg.error) throw new Error(reg.error.message);
  return { reaproveitada: false as const, ...(reg.data as ResultadoCredito) };
}

export const creditoConsultar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lead: z.string().uuid(), forcar: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const c = context as unknown as { userId: string };
    return consultarCreditoDaCandidata(data.lead, "manual", c.userId, data.forcar);
  });

export const nascimentoDefinir = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lead: z.string().uuid(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const c = context as unknown as { userId: string };
    const sb = await admin();
    const r = await sb.rpc("candidatura_nascimento_definir", { _lead: data.lead, _data: data.data, _usuario: c.userId });
    if (r.error) throw new Error(r.error.message.includes("permiss") ? "Sem permissão." : r.error.message);
    return { ok: true };
  });

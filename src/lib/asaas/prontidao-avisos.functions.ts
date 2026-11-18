/**
 * 18/11/2026 (Diego): "se faltar dados você precisa avisar". Confere AGORA, no Asaas, se a cliente vai receber os avisos
 * (e-mail, SMS, WhatsApp) e, a pedido, corrige o que é do lado do Asaas (dados e canais). Também reenvia os avisos das
 * parcelas abertas de um acordo. Nunca cria, cancela ou altera valor de cobrança.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avaliarProntidao, escolherContato, type ClienteAsaasLido, type ContatoLardan, type Prontidao } from "./prontidao-avisos";

type Rpc = { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
type Ctx = { supabase: Rpc; userId: string };
const uuid = /^[0-9a-f-]{36}$/i;
type Json = Record<string, unknown>;
type TransporteLeitura = {
  lerClienteCompleto?: (id: string) => Promise<Json | null>;
  lerAvisosCliente?: (id: string) => Promise<Json[] | null>;
  ativarAvisos?: (id: string, d: { email?: string | null; celular?: string | null }) => Promise<void>;
  reenviarAviso?: (id: string) => Promise<void>;
};
const texto = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function pode(c: Ctx, fn: string, args: object) {
  const { data, error } = await c.supabase.rpc(fn, args);
  return !error && data === true;
}

export interface ResultadoConferencia extends Prontidao { corrigidos: number; conferidoEm: string; cadastrosAsaas: number }

export const conferirAvisosAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partyId: string; corrigir?: boolean }) => {
    if (!uuid.test(d?.partyId ?? "")) throw new Error("Cliente inválida.");
    return { partyId: d.partyId, corrigir: !!d.corrigir };
  })
  .handler(async ({ data, context }): Promise<ResultadoConferencia> => {
    const c = context as unknown as Ctx;
    if (!(await pode(c, "cob_pode", { _u: c.userId }))) throw new Error("Sem permissão de cobrança.");
    if (data.corrigir && !(await pode(c, "has_capability", { _user_id: c.userId, _cap: "finance.receivable.manage" })))
      throw new Error("Você não tem permissão para alterar o cadastro no Asaas.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [pp, cps, vinc] = await Promise.all([
      supabaseAdmin.from("parties" as never).select("display_name, legal_name, doc_digits").eq("id", data.partyId).maybeSingle(),
      supabaseAdmin.from("contact_points" as never).select("kind, value, is_primary, updated_at").eq("party_id", data.partyId),
      supabaseAdmin.from("asaas_customers" as never).select("account_id, external_id").eq("party_id", data.partyId).eq("match_status", "vinculado"),
    ]);
    if (pp.error) throw new Error(pp.error.message);
    const p = pp.data as { display_name: string | null; legal_name: string | null; doc_digits: string | null } | null;
    if (!p) throw new Error("Cliente não encontrada.");
    const pontos = ((cps.data ?? []) as { kind: string; value: string; is_primary: boolean | null; updated_at: string | null }[])
      .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || String(b.updated_at).localeCompare(String(a.updated_at)));
    const lardan: ContatoLardan = {
      nome: p.display_name ?? p.legal_name,
      doc: p.doc_digits,
      emails: pontos.filter((x) => x.kind === "email").map((x) => x.value),
      telefones: pontos.filter((x) => x.kind === "whatsapp" || x.kind === "telefone").map((x) => ({ kind: x.kind, valor: x.value })),
    };
    const contato = escolherContato(lardan);

    const { resolverPorConta } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const lista = (vinc.data ?? []) as { account_id: string; external_id: string }[];
    const clientes: ClienteAsaasLido[] = [];
    let conta: { conectada: boolean; motivo?: string | null } = { conectada: true };
    let corrigidos = 0;
    for (const v of lista) {
      try {
        const r = await resolverPorConta(v.account_id, c.userId, data.corrigir ? "finance.receivable.manage" : "finance.receivable.view");
        if (!r.executavel) { conta = { conectada: false, motivo: "A conta Asaas não está conectada agora: nada foi conferido lá." }; continue; }
        const t = (await transporteDaResolucao(r)) as unknown as TransporteLeitura;
        if (!t.lerClienteCompleto || !t.lerAvisosCliente) { conta = { conectada: false, motivo: "Conta Asaas em modo de demonstração: não dá para conferir avisos reais." }; continue; }
        if (data.corrigir && t.ativarAvisos) { await t.ativarAvisos(v.external_id, contato); corrigidos++; }
        const [dados, avisos] = await Promise.all([t.lerClienteCompleto(v.external_id), t.lerAvisosCliente(v.external_id)]);
        clientes.push({ external_id: v.external_id, dados: dados as ClienteAsaasLido["dados"], avisos });
      } catch (e) {
        clientes.push({ external_id: v.external_id, dados: null, avisos: null, erro: texto(e) });
      }
    }
    const r = avaliarProntidao(lardan, clientes, conta);
    await supabaseAdmin.from("audit_logs" as never).insert({
      actor_id: c.userId, action: data.corrigir ? "asaas.avisos_corrigidos" : "asaas.avisos_conferidos", entity: "party", entity_id: data.partyId,
      payload: { corrigidos, pronto: r.pronto, faltas: r.faltas, itens: r.itens.filter((i) => i.status !== "ok").map((i) => i.chave) },
    } as never).then(() => undefined, () => undefined);
    return { ...r, corrigidos, conferidoEm: new Date().toISOString(), cadastrosAsaas: lista.length };
  });

/** Reenvia, pelo Asaas, o aviso de cada parcela ABERTA do acordo (PENDING/OVERDUE). Não mexe em valor nem vencimento. */
export const reenviarAvisosAcordo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { simId: string }) => {
    if (!uuid.test(d?.simId ?? "")) throw new Error("Acordo inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    if (!(await pode(c, "cob_pode", { _u: c.userId }))) throw new Error("Sem permissão de cobrança.");
    if (!(await pode(c, "has_capability", { _user_id: c.userId, _cap: "finance.receivable.manage" }))) throw new Error("Você não tem permissão para reenviar avisos do Asaas.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ints, error } = await supabaseAdmin.from("asaas_charge_intents" as never).select("charge_id").eq("acordo_simulacao_id", data.simId).not("charge_id", "is", null);
    if (error) throw new Error(error.message);
    const ids = [...new Set(((ints ?? []) as { charge_id: string }[]).map((i) => i.charge_id))];
    if (!ids.length) return { enviados: 0, abertas: 0, falhas: [] as string[] };
    const { data: chs } = await supabaseAdmin.from("asaas_charges" as never).select("id, external_id, external_status, due_date").in("id", ids);
    const abertas = ((chs ?? []) as { id: string; external_id: string; external_status: string; due_date: string }[]).filter((x) => ["PENDING", "OVERDUE"].includes(x.external_status));
    const { transporteDaCobranca } = await import("./servidor.server");
    let enviados = 0;
    const falhas: string[] = [];
    for (const ch of abertas) {
      try {
        const { transporte } = await transporteDaCobranca(ch.id, c.userId);
        const t = transporte as unknown as TransporteLeitura;
        if (!t.reenviarAviso) { falhas.push("Conta em modo de demonstração."); continue; }
        await t.reenviarAviso(ch.external_id);
        enviados++;
      } catch (e) { falhas.push(`${ch.due_date.split("-").reverse().join("/")}: ${texto(e)}`); }
    }
    await supabaseAdmin.from("audit_logs" as never).insert({ actor_id: c.userId, action: "asaas.acordo_avisos_reenviados", entity: "cob_simulacoes", entity_id: data.simId, payload: { enviados, abertas: abertas.length, falhas } } as never).then(() => undefined, () => undefined);
    return { enviados, abertas: abertas.length, falhas };
  });

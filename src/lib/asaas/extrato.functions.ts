import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Json = Record<string, unknown>;


/** Conta financeira que representa o saldo Asaas no razão (já cadastrada). */
export const contaExtratoAsaas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("financial_accounts")
      .select("id, nome")
      .ilike("nome", "%asaas%")
      .eq("is_active", true)
      .order("nome")
      .limit(1)
      .maybeSingle();
    return data ? { id: data.id as string, nome: data.nome as string } : null;
  });

/**
 * Busca o extrato da conta Asaas (somente leitura) e grava apenas as
 * movimentações ainda não trazidas, pela mesma rotina oficial de extratos.
 * A quitação acontece depois, no vínculo com a conta a pagar/receber.
 */
const diaSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

async function ultimaSync() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("audit_logs")
    .select("created_at, actor_id, payload")
    .eq("action", "asaas.extrato.sync")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { created_at: string; actor_id: string | null; payload: Json } | null;
}

/** Última sincronização registrada (automática da manhã ou manual). */
export const statusSyncExtratoAsaas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    void context;
    const u = await ultimaSync();
    if (!u) return null;
    let quem: string | null = null;
    if (u.actor_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: p } = await supabaseAdmin.from("profiles").select("full_name").eq("id", u.actor_id).maybeSingle();
      quem = (p?.full_name as string | undefined) ?? null;
    }
    return {
      quando: u.created_at,
      modo: String(u.payload["modo"] ?? "manual"),
      novas: Number(u.payload["novas"] ?? 0),
      total: Number(u.payload["total"] ?? 0),
      quem,
    };
  });

/**
 * Busca o extrato da conta Asaas (somente leitura) e grava apenas as
 * movimentações ainda não trazidas, pela mesma rotina oficial de extratos.
 * A quitação acontece depois, no vínculo com a conta a pagar/receber.
 *
 * modo "matinal": roda no máximo 1x por dia (a partir das 6h, horário de
 * Brasília), disparado pela primeira abertura da tela. Depois disso, só manual.
 * Toda execução fica registrada na auditoria.
 */
export const sincronizarExtratoAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { de: string; ate?: string; financial_account_id: string; modo?: "manual" | "matinal" }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.de)) throw new Error("Data inicial inválida.");
    if (input.ate && !/^\d{4}-\d{2}-\d{2}$/.test(input.ate)) throw new Error("Data final inválida.");
    if (!/^[0-9a-f-]{36}$/.test(input.financial_account_id)) throw new Error("Conta inválida.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const modo = data.modo === "matinal" ? "matinal" : "manual";
    const ultima = await ultimaSync();
    if (modo === "matinal") {
      const horaSP = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
      if (horaSP < 6) return { total: 0, novas: 0, pulado: true as const };
      if (ultima && diaSP(new Date(ultima.created_at)) === diaSP()) return { total: 0, novas: 0, pulado: true as const };
    } else if (ultima && Date.now() - new Date(ultima.created_at).getTime() < 60_000) {
      throw new Error("Uma busca acabou de ser feita. Aguarde um minuto antes de buscar de novo.");
    }

    const inicio = Date.now();
    const auditar = async (r: { total: number; novas: number; erro?: string }) => {
      await context.supabase.from("audit_logs").insert({
        actor_id: context.userId,
        action: "asaas.extrato.sync",
        entity: "financial_accounts",
        entity_id: data.financial_account_id,
        payload: { modo, de: data.de, ate: data.ate ?? null, ...r, ms: Date.now() - inicio } as never,
      });
    };
    try {
      const { executarSync } = await import("./extrato-sync.server");
      const r = await executarSync(data, context);
      await auditar(r);
      return { ...r, pulado: false as const };
    } catch (e) {
      const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
      await auditar({ total: 0, novas: 0, erro: msg });
      throw new Error(msg);
    }
  });

/** Verificação de saúde somente leitura: nunca cria nada no Asaas. */
export const saudeAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agora = new Date().toISOString();
    const { contasResolvidas } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const sb = context.supabase;
    const [ev, falhas, decisao, imp, ext] = await Promise.all([
      sb.from("asaas_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      // 0285: "na fila" = ainda não processado; o que já foi processado e espera alguém decidir é contado à parte.
      sb.from("asaas_events").select("id", { count: "exact", head: true }).eq("status", "na_fila").is("processed_at", null),
      sb.from("asaas_events").select("id", { count: "exact", head: true }).eq("status", "na_fila").not("processed_at", "is", null),
      sb.from("asaas_charge_sync_runs").select("iniciado_em,status,inseridas,atualizadas").order("iniciado_em", { ascending: false }).limit(1).maybeSingle(),
      sb.from("financial_statement_files").select("created_at").ilike("original_name", "Extrato Asaas%").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const base = {
      verificadoEm: agora,
      ultimoWebhook: (ev.data?.received_at as string | undefined) ?? null,
      falhasWebhook: 0,
      avisosNaFila: falhas.count ?? 0,
      avisosAguardandoDecisao: decisao.count ?? 0,
      ultimaImportacao: (imp.data?.iniciado_em as string | undefined) ?? null,
      situacaoImportacao: imp.data ? (imp.data.status === "concluida" ? "concluída" : String(imp.data.status)) : null,
      ultimoExtrato: (ext.data?.created_at as string | undefined) ?? null,
    };
    try {
      const contas = await contasResolvidas(context.userId);
      const alvo = contas.find((c) => c.r.executavel && c.r.transporte.tipo === "http");
      if (!alvo) {
        const motivo = contas.find((c) => c.r.situacao !== "conta_suspensa")?.r.motivo ?? "Nenhuma conta conectada.";
        return { ...base, ok: false, conta: null, ambiente: null, saldoCents: null, erro: motivo };
      }
      const t = (await transporteDaResolucao(alvo.r)) as unknown as { ambiente: string; consultarSaldo: () => Promise<number | null> };
      const saldo = await t.consultarSaldo();
      return { ...base, ok: true, conta: alvo.nome, ambiente: t.ambiente, saldoCents: saldo, erro: null };
    } catch (e) {
      const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 200);
      return { ...base, ok: false, conta: null, ambiente: null, saldoCents: null, erro: msg };
    }
  });

/** Processa eventos da fila cuja cobrança já está espelhada. Só atualiza a situação espelhada; nunca dá baixa. */
export const processarFilaAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const pode = await context.supabase.rpc("has_capability" as never, { _user_id: context.userId, _cap: "finance.receivable.manage" } as never);
    if (pode.error || pode.data !== true) throw new Error("Sem permissão para processar a fila do Asaas.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { drenarFilaAsaas } = await import("./fila.server");
    return drenarFilaAsaas(supabaseAdmin as never);
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Json = Record<string, unknown>;

const ROTULO_TIPO: Record<string, string> = {
  PAYMENT_RECEIVED: "Recebimento de cobrança",
  PAYMENT_FEE: "Tarifa de cobrança",
  TRANSFER: "Transferência",
  TRANSFER_FEE: "Tarifa de transferência",
  PIX_TRANSACTION_CREDIT: "Pix recebido",
  PIX_TRANSACTION_DEBIT: "Pix enviado",
  PIX_TRANSACTION_DEBIT_FEE: "Tarifa de Pix",
  BILL_PAYMENT: "Pagamento de conta",
  PAYMENT_REVERSAL: "Estorno",
  REFUND_REQUEST_CANCELLED: "Estorno cancelado",
  CHARGEBACK: "Chargeback",
  INSTANT_TEXT_MESSAGE_FEE: "Tarifa de aviso por WhatsApp",
  PHONE_CALL_NOTIFICATION_FEE: "Tarifa de aviso por robô de voz",
  PAYMENT_MESSAGING_NOTIFICATION_FEE: "Tarifa de mensageria",
};

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
      const r = await executarSync(data, context);
      await auditar(r);
      return { ...r, pulado: false as const };
    } catch (e) {
      const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
      await auditar({ total: 0, novas: 0, erro: msg });
      throw new Error(msg);
    }
  });

async function executarSync(
  data: { de: string; ate?: string; financial_account_id: string },
  context: { userId: string; supabase: SupabaseClient<Database> },
): Promise<{ total: number; novas: number }> {
    const { contasResolvidas } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const contas = await contasResolvidas(context.userId);
    const alvo = contas.find((c) => c.r.executavel && c.r.transporte.tipo === "http");
    if (!alvo) throw new Error("Nenhuma conta Asaas conectada e autorizada neste servidor.");
    const transporte = (await transporteDaResolucao(alvo.r)) as unknown as {
      listarExtrato: (f: { de: string; ate: string; limit: number; offset: number }) => Promise<{
        itens: Json[];
        hasMore: boolean;
        proximoOffset: number | null;
      }>;
    };
    const hoje = new Date().toISOString().slice(0, 10);
    const ate = data.ate && data.ate < hoje ? data.ate : hoje;

    const itens: Json[] = [];
    let offset = 0;
    for (let pagina = 0; pagina < 200; pagina += 1) {
      const p = await transporte.listarExtrato({ de: data.de, ate, limit: 100, offset });
      itens.push(...p.itens);
      if (!p.hasMore || p.proximoOffset === null) break;
      offset = p.proximoOffset;
    }

    // já trazidas antes: não regrava
    const ids = itens.map((i) => String(i["id"] ?? "")).filter(Boolean);
    const existentes = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: rows, error } = await context.supabase
        .from("financial_statement_lines")
        .select("bank_id")
        .eq("financial_account_id", data.financial_account_id)
        .in("bank_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (rows ?? []) as { bank_id: string | null }[]) if (r.bank_id) existentes.add(r.bank_id);
    }

    const novas = itens.filter((i) => i["id"] && !existentes.has(String(i["id"])));
    if (novas.length === 0) return { total: itens.length, novas: 0 };

    const linhas = novas.map((t, n) => {
      const valor = Math.round(Number(t["value"] ?? 0) * 100);
      const tipo = String(t["type"] ?? "");
      const desc = String(t["description"] ?? "").trim();
      return {
        line_no: n + 1,
        data: String(t["date"] ?? "").slice(0, 10),
        valor_cents: Math.abs(valor),
        kind: valor < 0 ? "saida" : valor > 0 ? "entrada" : "",
        historico: (desc || ROTULO_TIPO[tipo] || "Movimentação Asaas").slice(0, 500),
        documento: String(t["paymentId"] ?? t["transferId"] ?? ""),
        bank_id: String(t["id"]),
        raw: t,
        raw_text: JSON.stringify(t).slice(0, 2000),
        error_reason: "",
      };
    });

    const corpo = new TextEncoder().encode(JSON.stringify(linhas.map((l) => l.bank_id)));
    const dig = await crypto.subtle.digest("SHA-256", corpo);
    const sha = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const reg = await context.supabase.rpc("fin_statement_file_register", {
      _payload: {
        financial_account_id: data.financial_account_id,
        storage_path: `asaas-api/${ate}/${sha.slice(0, 12)}`,
        original_name: `Extrato Asaas ${data.de} a ${ate}`,
        format: "csv",
        size_bytes: corpo.byteLength,
        sha256: sha,
      },
    });
    if (reg.error) throw new Error(reg.error.message);
    const r = reg.data as { import_id: string; repetido: boolean; concluido?: boolean };
    if (r.repetido && r.concluido !== false) return { total: itens.length, novas: 0 };
    const st = await context.supabase.rpc("fin_statement_lines_stage", { _import: r.import_id, _lines: linhas as never });
    if (st.error) throw new Error(st.error.message);
    return { total: itens.length, novas: linhas.length };
}

/** Verificação de saúde somente leitura: nunca cria nada no Asaas. */
export const saudeAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agora = new Date().toISOString();
    const { contasResolvidas } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const sb = context.supabase;
    const [ev, falhas, imp, ext] = await Promise.all([
      sb.from("asaas_events").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("asaas_events").select("id", { count: "exact", head: true }).not("last_error", "is", null),
      sb.from("asaas_import_runs").select("created_at,status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("financial_statement_files").select("created_at").ilike("original_name", "Extrato Asaas%").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const base = {
      verificadoEm: agora,
      ultimoWebhook: (ev.data?.received_at as string | undefined) ?? null,
      falhasWebhook: falhas.count ?? 0,
      ultimaImportacao: (imp.data?.created_at as string | undefined) ?? null,
      situacaoImportacao: (imp.data?.status as string | undefined) ?? null,
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

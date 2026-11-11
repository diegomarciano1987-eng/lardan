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

const diaSP = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);

/**
 * Busca o extrato da conta Asaas (somente leitura) e grava apenas as movimentações ainda não trazidas,
 * pela rotina oficial de extratos. Usada pelo botão (sessão do usuário) e pela rotina de hora em hora (serviço).
 */
export async function executarSync(
  data: { de: string; ate?: string; financial_account_id: string },
  context: { userId: string; supabase: SupabaseClient<Database>; servico?: boolean },
): Promise<{ total: number; novas: number }> {
    const { contasResolvidas } = await import("./servidor.server");
    const { transporteDaResolucao } = await import("./configuracao.server");
    const contas = await contasResolvidas(context.userId);
    const alvo = contas.find((c) => c.r.executavel && c.r.transporte.tipo === "http");
    if (!alvo) throw new Error("Nenhuma conta Asaas conectada e autorizada neste servidor.");
    // destino vem da ligação explícita conta Asaas → conta financeira, nunca do navegador
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg, error } = await supabaseAdmin
        .from("asaas_accounts")
        .select("financial_account_id, owner_entity_id")
        .eq("id", alvo.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const destino = (cfg as { financial_account_id: string | null } | null)?.financial_account_id;
      if (!destino) throw new Error("A conta Asaas ainda não está ligada a uma conta financeira.");
      if (data.financial_account_id && data.financial_account_id !== destino) {
        throw new Error("Conta de destino diferente da ligada à conta Asaas.");
      }
      const { data: fin } = await supabaseAdmin
        .from("financial_accounts")
        .select("business_entity_id, is_active")
        .eq("id", destino)
        .maybeSingle();
      const f = fin as { business_entity_id: string | null; is_active: boolean } | null;
      const dono = (cfg as { owner_entity_id: string | null }).owner_entity_id;
      if (!f || f.is_active === false) throw new Error("Conta financeira ligada ao Asaas está inativa.");
      if (f.business_entity_id && dono && f.business_entity_id !== dono) {
        throw new Error("Conta financeira ligada pertence a outra empresa.");
      }
      data = { ...data, financial_account_id: destino };
    }
    const transporte = (await transporteDaResolucao(alvo.r)) as unknown as {
      listarExtrato: (f: { de: string; ate: string; limit: number; offset: number }) => Promise<{
        itens: Json[];
        hasMore: boolean;
        proximoOffset: number | null;
      }>;
    };
    const hoje = diaSP();
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

    const { paraCentavos } = await import("@/lib/asaas/transporte-http.server");
    const linhas = novas.map((t, n) => {
      const valor = paraCentavos(t["value"] ?? 0) ?? 0;
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

    const arquivo = {
        financial_account_id: data.financial_account_id,
        storage_path: `asaas-api/${ate}/${sha.slice(0, 12)}`,
        original_name: `Extrato Asaas ${data.de} a ${ate}`,
        format: "csv",
        size_bytes: corpo.byteLength,
        sha256: sha,
    };
    if (context.servico) {
      // 0285: rotina de hora em hora — mesma rotina oficial, em nome do responsável técnico da cobrança
      const g = await context.supabase.rpc("asaas_extrato_gravar_servico" as never, { _arquivo: arquivo, _linhas: linhas } as never);
      if (g.error) throw new Error(g.error.message);
      return { total: itens.length, novas: linhas.length };
    }
    const reg = await context.supabase.rpc("fin_statement_file_register", { _payload: arquivo });
    if (reg.error) throw new Error(reg.error.message);
    const r = reg.data as { import_id: string; repetido: boolean; concluido?: boolean };
    if (r.repetido && r.concluido !== false) return { total: itens.length, novas: 0 };
    const st = await context.supabase.rpc("fin_statement_lines_stage", { _import: r.import_id, _lines: linhas as never });
    if (st.error) throw new Error(st.error.message);
    return { total: itens.length, novas: linhas.length };
}

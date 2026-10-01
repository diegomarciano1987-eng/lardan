import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Conta Asaas de produção (fixa). Sandbox nunca entra no espelho operacional. */
const CONTA_PRODUCAO = "c5362598-6dc8-41ae-b32b-65bd7b3208c3";
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Espelha as cobranças existentes no Asaas (por vencimento) — somente leitura no provedor.
 * Não cria cobrança, não notifica cliente, não vincula e não dá baixa. Idempotente por
 * (conta, id externo): repetir a sincronização só atualiza o estado.
 */
export const sincronizarCobrancasAsaas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { de: string; ate: string }) => {
    if (!DATA.test(i.de) || !DATA.test(i.ate) || i.de > i.ate) throw new Error("Período inválido.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: pode } = await context.supabase.rpc("has_capability", {
      _user_id: context.userId,
      _cap: "finance.receivable.view",
    } as never);
    if (!pode) throw new Error("Sem permissão.");
    const chave = process.env["ASAAS_PRODUCAO_LARDAN"];
    if (!chave) throw new Error("Chave do Asaas de produção não configurada.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ultima } = await supabaseAdmin
      .from("asaas_charge_sync_runs" as never)
      .select("iniciado_em")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    const u = ultima as { iniciado_em: string } | null;
    if (u && Date.now() - new Date(u.iniciado_em).getTime() < 60_000) {
      throw new Error("Uma sincronização acabou de ser feita. Aguarde um minuto.");
    }

    const { data: run } = await supabaseAdmin
      .from("asaas_charge_sync_runs" as never)
      .insert({ account_id: CONTA_PRODUCAO, filtro: "vencimento", de: data.de, ate: data.ate, iniciado_por: context.userId } as never)
      .select("id")
      .single();
    const runId = (run as { id: string } | null)?.id;
    let paginas = 0, recebidas = 0, inseridas = 0, atualizadas = 0;
    try {
      let offset = 0;
      for (;;) {
        const qs = new URLSearchParams({ "dueDate[ge]": data.de, "dueDate[le]": data.ate, limit: "100", offset: String(offset) });
        const resp = await fetch(`https://api.asaas.com/v3/payments?${qs}`, {
          headers: { access_token: chave, "User-Agent": "lardan-espelho" },
        });
        if (!resp.ok) throw new Error(`Asaas respondeu ${resp.status}.`);
        const j = (await resp.json()) as { data: Record<string, unknown>[]; hasMore: boolean };
        paginas++;
        recebidas += j.data.length;
        if (j.data.length) {
          const { data: r, error } = await supabaseAdmin.rpc("asaas_espelho_upsert" as never, {
            _account_id: CONTA_PRODUCAO,
            _rows: j.data,
          } as never);
          if (error) throw new Error(error.message);
          const rr = r as { inseridas: number; atualizadas: number };
          inseridas += rr.inseridas;
          atualizadas += rr.atualizadas;
        }
        if (!j.hasMore) break;
        offset += 100;
        if (paginas > 200) throw new Error("Limite de páginas atingido; sincronização parcial.");
      }
      await supabaseAdmin
        .from("asaas_charge_sync_runs" as never)
        .update({ status: "concluida", paginas, recebidas, inseridas, atualizadas, concluido_em: new Date().toISOString() } as never)
        .eq("id", runId as never);
      return { paginas, recebidas, inseridas, atualizadas };
    } catch (e) {
      const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
      await supabaseAdmin
        .from("asaas_charge_sync_runs" as never)
        .update({ status: "falhou", paginas, recebidas, inseridas, atualizadas, erro: msg, concluido_em: new Date().toISOString() } as never)
        .eq("id", runId as never);
      throw new Error(msg);
    }
  });

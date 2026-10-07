/** Núcleo da sincronização do espelho Asaas — usado pelo botão manual e pela rotina da manhã. */
export const CONTA_PRODUCAO = "c5362598-6dc8-41ae-b32b-65bd7b3208c3";

export async function executarSyncAsaas(p: { actor: string; de: string; ate: string; ignorarIntervalo?: boolean }) {
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
  if (!p.ignorarIntervalo && u && Date.now() - new Date(u.iniciado_em).getTime() < 60_000) {
    throw new Error("Uma sincronização acabou de ser feita. Aguarde um minuto.");
  }

  const { data: run } = await supabaseAdmin
    .from("asaas_charge_sync_runs" as never)
    .insert({ account_id: CONTA_PRODUCAO, filtro: "todas", de: p.de, ate: p.ate, iniciado_por: p.actor } as never)
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id;
  let paginas = 0, recebidas = 0, inseridas = 0, atualizadas = 0;
  try {
    let offset = 0;
    for (;;) {
      const qs = new URLSearchParams({ limit: "100", offset: String(offset) });
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
    let vinculadas = 0, ambiguas = 0, baixas = 0;
    const { data: conc, error: ec } = await supabaseAdmin.rpc("asaas_conciliacao_automatica" as never, {
      _actor: p.actor, _executar: true,
    } as never);
    if (!ec && conc) ({ vinculadas, ambiguas, baixas } = conc as { vinculadas: number; ambiguas: number; baixas: number });
    return { paginas, recebidas, inseridas, atualizadas, vinculadas, ambiguas, baixas, conciliacaoErro: ec?.message ?? null };
  } catch (e) {
    const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
    await supabaseAdmin
      .from("asaas_charge_sync_runs" as never)
      .update({ status: "falhou", paginas, recebidas, inseridas, atualizadas, erro: msg, concluido_em: new Date().toISOString() } as never)
      .eq("id", runId as never);
    throw new Error(msg);
  }
}

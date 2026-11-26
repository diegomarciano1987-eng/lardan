/**
 * 0395 — Captação: depois do teste, consulta o crédito (Assertiva) e aplica a decisão (aprova sozinho ou manda para o Daniel).
 * Roda pela rotina de 1 minuto (/api/public/captacao/processar) e também logo ao concluir o teste (para responder em minutos).
 * A recusa nunca é automática. Falha de consulta fica na fila e tenta de novo (2, 4, 6… minutos; até 8 vezes).
 */
type Admin = { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Admin;

export async function processarLead(lead: string): Promise<{ lead: string; decisao?: string; erro?: string }> {
  const sb = await admin();
  try {
    const { consultarCreditoDaCandidata } = await import("@/lib/credito/credito.functions");
    const r = await consultarCreditoDaCandidata(lead, "automatica", null, false);
    if (!r.reaproveitada && r.situacao === "erro") throw new Error("A consulta de crédito falhou; tenta de novo em alguns minutos.");
    const d = await sb.rpc("captacao_decidir", { _lead: lead });
    if (d.error) throw new Error(d.error.message);
    const decisao = (d.data as { decisao?: string } | null)?.decisao ?? "";
    if (decisao === "aguardando") throw new Error("Aguardando teste ou consulta.");
    await sb.rpc("captacao_fila_concluir", { _lead: lead, _erro: null });
    return { lead, decisao };
  } catch (e) {
    const erro = (e as Error).message.slice(0, 300);
    // sem CPF válido não adianta tentar de novo: vai direto para a revisão do Daniel
    if (/sem CPF válido|não encontrada/i.test(erro)) {
      await sb.rpc("captacao_revisar", { _lead: lead, _motivo: erro });
      await sb.rpc("captacao_fila_concluir", { _lead: lead, _erro: null });
      return { lead, decisao: "revisao" };
    }
    await sb.rpc("captacao_fila_concluir", { _lead: lead, _erro: erro });
    return { lead, erro };
  }
}

export async function processarFila(n = 10) {
  const sb = await admin();
  const { data, error } = await sb.rpc("captacao_fila_pegar", { _n: n });
  if (error) throw new Error(error.message);
  const leads = ((data ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : String((x as Record<string, unknown>)["captacao_fila_pegar"] ?? x)));
  const resultados = [];
  for (const lead of leads) resultados.push(await processarLead(lead));
  return { processadas: resultados.length, resultados: resultados.map((r) => ({ decisao: r.decisao ?? null, erro: r.erro ?? null })) };
}

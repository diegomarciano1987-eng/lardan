/** Núcleo da sincronização do espelho Asaas — usado pelo botão manual e pela rotina da manhã. */
export const CONTA_PRODUCAO = "c5362598-6dc8-41ae-b32b-65bd7b3208c3";

const BASE = "https://api.asaas.com/v3";
const LIMITE_PAGINAS_POR_PASSADA = 2000; // 200 mil cobranças por passada; trava só contra laço infinito

/** GET no Asaas com tempo-limite e espera em 429/5xx (até 5 tentativas). */
async function getAsaas(chave: string, caminho: string): Promise<Record<string, unknown>> {
  let espera = 2000;
  for (let tentativa = 1; ; tentativa++) {
    let resp: Response;
    try {
      resp = await fetch(`${BASE}${caminho}`, {
        headers: { access_token: chave, "User-Agent": "lardan-espelho" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (tentativa >= 5) throw new Error(`Asaas sem resposta: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, espera));
      espera *= 2;
      continue;
    }
    if (resp.ok) return (await resp.json()) as Record<string, unknown>;
    if ((resp.status === 429 || resp.status >= 500) && tentativa < 5) {
      const ra = Number(resp.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : espera));
      espera *= 2;
      continue;
    }
    throw new Error(`Asaas respondeu ${resp.status}.`);
  }
}

/**
 * Modos:
 *  - "diario": só o que mudou na janela [de, ate] — cobranças criadas, vencidas ou pagas no período
 *    (três passadas filtradas; o upsert é idempotente, então sobreposição não duplica).
 *  - "completo": todas as cobranças da conta, sem teto de 20 mil (conferência semanal).
 */
export async function executarSyncAsaas(p: { actor: string; de: string; ate: string; ignorarIntervalo?: boolean; modo?: "diario" | "completo" }) {
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
    .insert({ account_id: CONTA_PRODUCAO, filtro: p.modo === "completo" ? "todas" : "janela", de: p.de, ate: p.ate, iniciado_por: p.actor } as never)
    .select("id")
    .single();
  const runId = (run as { id: string } | null)?.id;
  let paginas = 0, recebidas = 0, inseridas = 0, atualizadas = 0;
  try {
    const modo = p.modo ?? "diario";
    const passadas: Record<string, string>[] =
      modo === "completo"
        ? [{}]
        : [
            { "dateCreated[ge]": p.de, "dateCreated[le]": p.ate },
            { "paymentDate[ge]": p.de, "paymentDate[le]": p.ate },
            { "dueDate[ge]": p.de },
          ];
    for (const filtro of passadas) {
      let offset = 0;
      for (let pagina = 0; ; pagina++) {
        if (pagina >= LIMITE_PAGINAS_POR_PASSADA) throw new Error("Limite de segurança de páginas atingido; sincronização parcial.");
        const qs = new URLSearchParams({ ...filtro, limit: "100", offset: String(offset) });
        const j = (await getAsaas(chave, `/payments?${qs}`)) as { data: Record<string, unknown>[]; hasMore: boolean };
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
        if (!j.hasMore || j.data.length === 0) break;
        offset += j.data.length;
      }
    }
    await supabaseAdmin
      .from("asaas_charge_sync_runs" as never)
      .update({ status: "concluida", paginas, recebidas, inseridas, atualizadas, concluido_em: new Date().toISOString() } as never)
      .eq("id", runId as never);
    // clientes do Asaas que ainda não estão no espelho (necessários para achar a pessoa pelo CPF)
    let clientesNovos = 0;
    try {
      const lerTudo = async (tabela: string, coluna: string) => {
        const out: string[] = [];
        for (let de = 0; ; de += 1000) {
          const { data } = await supabaseAdmin.from(tabela as never).select(coluna)
            .eq("account_id", CONTA_PRODUCAO as never).not(coluna, "is", null).range(de, de + 999);
          const linhas = (data ?? []) as unknown as Record<string, string>[];
          out.push(...linhas.flatMap((x) => typeof x[coluna] === "string" ? [x[coluna]] : []));
          if (linhas.length < 1000) break;
        }
        return out;
      };
      const tem = new Set(await lerTudo("asaas_customers", "external_id"));
      const faltam = [...new Set(await lerTudo("asaas_charges", "customer_external_id"))].filter((x) => !tem.has(x)).slice(0, 300);
      for (const id of faltam) {
        let c: Record<string, unknown>;
        try { c = await getAsaas(chave, `/customers/${encodeURIComponent(id)}`); } catch { continue; }
        const { error } = await supabaseAdmin.from("asaas_customers" as never).upsert({
          account_id: CONTA_PRODUCAO, external_id: id, name: c["name"] ?? null, doc: c["cpfCnpj"] ?? null, email: c["email"] ?? null, raw: c,
        } as never, { onConflict: "account_id,external_id" });
        if (!error) clientesNovos++;
      }
    } catch { /* segue: conciliação usa o que já existe */ }
    let vinculadas = 0, ambiguas = 0, baixas = 0;
    const { data: conc, error: ec } = await supabaseAdmin.rpc("asaas_conciliacao_automatica" as never, {
      _actor: p.actor, _executar: true,
    } as never);
    if (!ec && conc) ({ vinculadas, ambiguas, baixas } = conc as { vinculadas: number; ambiguas: number; baixas: number });
    return { paginas, recebidas, inseridas, atualizadas, clientesNovos, vinculadas, ambiguas, baixas, conciliacaoErro: ec?.message ?? null };
  } catch (e) {
    const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
    await supabaseAdmin
      .from("asaas_charge_sync_runs" as never)
      .update({ status: "falhou", paginas, recebidas, inseridas, atualizadas, erro: msg, concluido_em: new Date().toISOString() } as never)
      .eq("id", runId as never);
    throw new Error(msg);
  }
}

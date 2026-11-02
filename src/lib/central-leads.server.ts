// Envio da fila de candidaturas (Seja Lardan) para a Central de Leads Small Data.
// Arquivo permanente: só envia criação; nunca exclusão, status ou reenvio modificado.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Conexao = { endpoint: string; key: string };

export function lerConexao(): Conexao | null {
  const bruto = process.env["CENTRAL_LEADS_CONNECTION"];
  if (!bruto) return null;
  try {
    const bin = atob(bruto.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const j = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Conexao>;
    if (typeof j.endpoint !== "string" || typeof j.key !== "string") return null;
    if (!/^https:\/\//.test(j.endpoint)) return null;
    return { endpoint: j.endpoint, key: j.key };
  } catch {
    return null;
  }
}

/** Backoff exponencial com jitter: 1, 2, 4… min, teto 6 h. */
export function atrasoMs(tentativas: number, aleatorio = Math.random()): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, tentativas - 1), 6 * 3600_000);
  return Math.round(base * (0.75 + aleatorio * 0.5));
}

export type Classificacao = "enviado" | "retentar" | "erro" | "conexao";
export function classificar(status: number): Classificacao {
  if (status === 200 || status === 201) return "enviado";
  if (status === 401) return "conexao";
  if (status === 429 || status >= 500 || status === 0) return "retentar";
  return "erro";
}

export async function processarFila(limite = 20, orcamentoMs = 3_500) {
  const inicio = Date.now();
  const db = supabaseAdmin as any;
  const { data: estado } = await db.from("central_leads_estado").select("*").eq("id", true).single();
  const conexao = lerConexao();
  if (!conexao) return { pausado: true, motivo: "conexão ausente ou inválida", enviados: 0 };
  if (estado?.pausado_conexao) {
    // Retoma automaticamente quando a conexão for trocada (outra chave).
    return { pausado: true, motivo: estado.pausado_motivo, enviados: 0 };
  }
  const { data: itens, error } = await db
    .from("central_leads_fila")
    .select("id, evento_id, payload, tentativas")
    .in("status", ["pendente", "retentar"])
    .lte("proxima_em", new Date().toISOString())
    .order("ocorrido_em", { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);

  const r = { enviados: 0, duplicados: 0, retentar: 0, erros: 0, pausado: false };
  for (const it of itens ?? []) {
    if (Date.now() - inicio > orcamentoMs) break;
    let status = 0;
    let corpo: any = null;
    try {
      const resp = await fetch(conexao.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-central-key": conexao.key },
        body: JSON.stringify(it.payload),
        signal: AbortSignal.timeout(2_500),
      });
      status = resp.status;
      corpo = await resp.json().catch(() => null);
    } catch {
      status = 0;
    }
    const c = classificar(status);
    const tent = it.tentativas + 1;
    const upd: Record<string, unknown> = { tentativas: tent, ultimo_status_http: status || null };
    if (c === "enviado") {
      Object.assign(upd, { status: "enviado", enviado_em: new Date().toISOString(), duplicado: corpo?.duplicate === true, ultimo_erro: null });
      r.enviados++;
      if (corpo?.duplicate === true) r.duplicados++;
    } else if (c === "retentar") {
      Object.assign(upd, { status: "retentar", proxima_em: new Date(Date.now() + atrasoMs(tent)).toISOString(), ultimo_erro: status ? `HTTP ${status}` : "falha de rede" });
      r.retentar++;
    } else if (c === "erro") {
      const msg = typeof corpo?.error === "string" ? corpo.error.slice(0, 300) : "";
      Object.assign(upd, { status: "erro", ultimo_erro: `HTTP ${status}${msg ? ": " + msg : ""}` });
      r.erros++;
    } else {
      await db.from("central_leads_fila").update({ tentativas: it.tentativas, ultimo_status_http: 401, ultimo_erro: "HTTP 401: conexão recusada" }).eq("id", it.id);
      await db.from("central_leads_estado").update({ pausado_conexao: true, pausado_motivo: "Central recusou a chave (401): gerar nova conexão", atualizado_em: new Date().toISOString() }).eq("id", true);
      r.pausado = true;
      break;
    }
    await db.from("central_leads_fila").update(upd).eq("id", it.id);
  }
  return r;
}

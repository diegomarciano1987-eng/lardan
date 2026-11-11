/**
 * Fila de avisos do Asaas (0282, revisado 0285). O aviso que chega antes de a cobrança existir no espelho fica
 * "na_fila" sem processed_at. A rotina (manhã, a cada poucos minutos e o botão) processa só esses: os avisos
 * já processados que ficaram "na_fila" aguardam decisão humana (cobrança sem título, apagada etc.) e
 * reprocessá-los não muda nada — era isso que fazia o botão rodar centenas de chamadas e parecer travado.
 * Só atualiza a situação espelhada e a baixa que o próprio asaas_evento_processar já faz.
 * Somente servidor (service_role).
 */
type Admin = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export interface ResultadoFila {
  naFila: number;
  processados: number;
  falhas: number;
  semCobranca: number;
  /** true quando o tempo acabou antes do fim; o restante fica para a próxima rodada. */
  parcial?: boolean;
}

export async function drenarFilaAsaas(admin: Admin, limite = 300, orcamentoMs = 20_000): Promise<ResultadoFila> {
  const inicio = Date.now();
  const fila = await admin.from("asaas_events").select("id,charge_external_id,account_id")
    .eq("status", "na_fila").is("processed_at", null).order("event_at", { ascending: true }).limit(limite);
  if (fila.error) throw new Error(fila.error.message);
  const linhas = (fila.data ?? []) as { id: string; charge_external_id: string | null; account_id: string }[];
  const ids = [...new Set(linhas.map((e) => e.charge_external_id).filter(Boolean))] as string[];
  const espelhadas = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await admin.from("asaas_charges").select("account_id,external_id").in("external_id", ids.slice(i, i + 200));
    if (r.error) throw new Error(r.error.message);
    for (const c of (r.data ?? []) as { account_id: string; external_id: string }[]) espelhadas.add(`${c.account_id}|${c.external_id}`);
  }
  const alvo = linhas.filter((e) => e.charge_external_id && espelhadas.has(`${e.account_id}|${e.charge_external_id}`));
  let processados = 0, falhas = 0, parcial = false;
  // Em ordem (eventos da mesma cobrança dependem da sequência), com teto de tempo para nunca travar a tela.
  for (const e of alvo) {
    if (Date.now() - inicio > orcamentoMs) { parcial = true; break; }
    const r = await admin.rpc("asaas_evento_processar", { _evento: e.id });
    if (r.error) falhas++; else processados++;
  }
  return { naFila: linhas.length, processados, falhas, semCobranca: linhas.length - alvo.length, ...(parcial ? { parcial } : {}) };
}

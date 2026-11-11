/**
 * Fila de avisos do Asaas (0282). O aviso que chega antes de a cobrança existir no espelho fica "na_fila"
 * com "Evento sem cobrança espelhada". A rotina da manhã espelha as cobranças; logo depois esta função
 * processa os avisos cujas cobranças já estão no espelho. Só atualiza a situação espelhada e a baixa que o
 * próprio asaas_evento_processar já faz; cobrança sem título continua na Mesa de conciliação.
 * Somente servidor (service_role).
 */
type Admin = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export interface ResultadoFila { naFila: number; processados: number; falhas: number; semCobranca: number }

export async function drenarFilaAsaas(admin: Admin, limite = 1000): Promise<ResultadoFila> {
  const fila = await admin.from("asaas_events").select("id,charge_external_id,account_id")
    .eq("status", "na_fila").order("event_at", { ascending: true }).limit(limite);
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
  let processados = 0, falhas = 0;
  for (const e of alvo) {
    const r = await admin.rpc("asaas_evento_processar", { _evento: e.id });
    if (r.error) falhas++; else processados++;
  }
  return { naFila: linhas.length, processados, falhas, semCobranca: linhas.length - alvo.length };
}

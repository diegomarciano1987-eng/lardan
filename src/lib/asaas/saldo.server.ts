/**
 * 0299 — Espelho de saldo Lardan → Asaas (somente servidor).
 *
 * Baixa no Lardan (manual, OFX, outra conta, desconto) ou título cancelado deixa a cobrança do Asaas cobrando a mais.
 * O banco planeja (asaas_saldo_reservar); aqui: conferir no Asaas, cancelar a antiga, criar a nova pelo saldo exato
 * pelo executor oficial (mesma intenção/posse/idempotência do "Gerar link"). Nada aqui lança dinheiro.
 */
import type { BancoAsaas } from "./banco";
import type { TransporteAsaas } from "./contrato";
import { executarIntencao } from "./cobranca";

export interface DepsSaldo {
  servico: BancoAsaas;
  transporteCobranca: (chargeId: string) => Promise<TransporteAsaas>;
  transporteIntencao: (intentId: string) => Promise<TransporteAsaas>;
  worker?: string;
  limite?: number;
}

type Cobranca = { charge_id: string; external_id: string; valor_cents: number };
type Tarefa = { id: string; acao: string; motivo: string; cancelar: Cobranca[]; intent_id: string | null; intent_state: string | null };
export type ResultadoTarefa = { id: string; estado: string; erro?: string | null; nova?: string | null };

const PAGAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const ABERTAS = new Set(["PENDING", "OVERDUE"]);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 400);

async function cancelarUma(d: DepsSaldo, c: Cobranca) {
  try {
    const t = await d.transporteCobranca(c.charge_id);
    // sempre conferir antes: nunca excluir uma cobrança que a cliente acabou de pagar
    const remoto = await t.consultarCobranca(c.external_id);
    if (!remoto || remoto.status === "DELETED") return { resultado: "ja_excluida", status: remoto?.status ?? null, erro: null };
    if (PAGAS.has(remoto.status)) return { resultado: "paga_no_asaas", status: remoto.status, erro: null };
    if (!ABERTAS.has(remoto.status)) return { resultado: "falhou", status: remoto.status, erro: `Situação no Asaas: ${remoto.status}` };
    if (!t.cancelarCobranca) return { resultado: "falhou", status: remoto.status, erro: "Esta conta não permite cancelar pelo sistema." };
    await t.cancelarCobranca(c.external_id);
    return { resultado: "cancelada", status: remoto.status, erro: null };
  } catch (e) {
    // resposta perdida depois do DELETE: a próxima rodada consulta e reconhece "já excluída"
    return { resultado: "falhou", status: null, erro: msg(e) };
  }
}

async function processar(d: DepsSaldo, worker: string, t: Tarefa): Promise<ResultadoTarefa> {
  for (const c of t.cancelar) {
    const r = await cancelarUma(d, c);
    const x = await d.servico.rpc<{ continuar: boolean }>("asaas_saldo_cancelamento", {
      _job: t.id, _worker: worker, _charge: c.charge_id, _resultado: r.resultado, _status_remoto: r.status, _erro: r.erro,
    });
    if (!x.continuar) return { id: t.id, estado: r.resultado === "paga_no_asaas" ? "excecao" : "falhou", erro: r.erro };
  }
  const p = await d.servico.rpc<{ executar: boolean; intent_id?: string; estado?: string }>("asaas_saldo_preparar", { _job: t.id, _worker: worker });
  if (!p.executar || !p.intent_id) return { id: t.id, estado: p.estado ?? "concluida" };
  const transporte = await d.transporteIntencao(p.intent_id);
  const res = await executarIntencao(d.servico, transporte, p.intent_id, { actor: null, worker });
  const fim = await d.servico.rpc<{ estado: string }>("asaas_saldo_concluir", { _job: t.id, _worker: worker, _erro: res.erro ?? res.aviso ?? null });
  return { id: t.id, estado: fim.estado, nova: res.external_id ?? null, erro: res.erro ?? null };
}

export async function sincronizarSaldos(d: DepsSaldo) {
  const worker = d.worker ?? `saldo-${Math.random().toString(36).slice(2, 10)}`;
  const r = await d.servico.rpc<{ varridas: number; tarefas: Tarefa[] }>("asaas_saldo_reservar", { _worker: worker, _limite: d.limite ?? 20 });
  const resultados: ResultadoTarefa[] = [];
  for (const t of r.tarefas) {
    try {
      resultados.push(await processar(d, worker, t));
    } catch (e) {
      const erro = msg(e);
      await d.servico.rpc("asaas_saldo_concluir", { _job: t.id, _worker: worker, _erro: erro }).catch(() => undefined);
      resultados.push({ id: t.id, estado: "falhou", erro });
    }
  }
  return { varridas: r.varridas, processadas: r.tarefas.length, resultados };
}

/** Produção: executor de serviço + transporte resolvido pela configuração da conta de cada cobrança/intenção. */
export async function sincronizarSaldosProducao(limite = 20) {
  const { bancoExecutor, transporteDaCobranca, transporteDaIntencao } = await import("./servidor.server");
  return sincronizarSaldos({
    servico: await bancoExecutor(),
    limite,
    transporteCobranca: async (id) => (await transporteDaCobranca(id, null)).transporte,
    transporteIntencao: async (id) => (await transporteDaIntencao(id, null)).transporte,
  });
}

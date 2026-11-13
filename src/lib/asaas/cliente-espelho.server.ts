/**
 * 0306 — espelho do cadastro Lardan → cliente Asaas (somente servidor).
 * O banco reserva quem mudou (asaas_cliente_espelho_proximos); aqui: ler no Asaas, mandar só o que difere,
 * ler de novo para confirmar e gravar o de → para (asaas_cliente_espelho_registrar). Nunca apaga campo do Asaas.
 */
import type { BancoAsaas } from "./banco";
import { RecusadoPeloProvedor } from "./contrato";
import { CAMPOS, comparar, normalizar, type Campo, type DadosCliente, type Diferenca } from "./cliente-espelho";

type Item = {
  customer_id: string; party_id: string; account_id: string; external_id: string;
  primeira: boolean; forcar: boolean; forcado_por: string | null;
  lardan: DadosCliente; conhecidos: string[]; celular_compartilhado: boolean;
};
export interface TransporteCliente {
  lerClienteCompleto?(id: string): Promise<Record<string, unknown> | null>;
  atualizarClienteCampos?(id: string, campos: Record<string, string>): Promise<void>;
}
export interface DepsCliente {
  servico: BancoAsaas;
  transporteConta: (accountId: string) => Promise<TransporteCliente>;
  worker?: string;
  limite?: number;
  party?: string | null;
  actor?: string | null;
}
export type ResultadoCliente = { customer: string; estado: string; enviados: string[]; erro?: string | null };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 400);

function paraDados(raw: Record<string, unknown> | null): DadosCliente & { notificationDisabled?: boolean | null } {
  const d: DadosCliente & { notificationDisabled?: boolean | null } = {};
  for (const k of CAMPOS) {
    const v = raw?.[k];
    d[k] = v === null || v === undefined ? null : String(v);
  }
  d.notificationDisabled = raw?.["notificationDisabled"] === true;
  return d;
}

async function umCliente(d: DepsCliente, worker: string, it: Item, transporte: TransporteCliente): Promise<ResultadoCliente> {
  const fim = async (estado: string, difs: Diferenca[], enviados: Record<string, { de: string | null; para: string | null }> = {}, erro: string | null = null) => {
    const r = await d.servico.rpc<string>("asaas_cliente_espelho_registrar", {
      _customer: it.customer_id, _worker: worker, _estado: estado, _diferencas: difs, _enviados: enviados, _erro: erro, _actor: d.actor ?? null,
    });
    return { customer: it.external_id, estado: r, enviados: Object.keys(enviados), erro };
  };
  try {
    if (!transporte.lerClienteCompleto || !transporte.atualizarClienteCampos) return fim("erro", [], {}, "Conta Asaas em modo de demonstração: nada foi alterado.");
    const antesRaw = await transporte.lerClienteCompleto(it.external_id);
    if (!antesRaw || antesRaw["deleted"] === true) return fim("excluido_no_asaas", []);
    const antes = paraDados(antesRaw);
    const opc = { primeira: it.primeira, conhecidos: it.conhecidos ?? [], celularCompartilhado: it.celular_compartilhado, forcar: it.forcar };
    const c1 = comparar(it.lardan, antes, opc);
    const pedidos = Object.entries(c1.enviar) as [Campo, string][];
    if (!pedidos.length) return fim(c1.diferencas.length ? "diferente" : "igual", c1.diferencas);

    const recusados: Diferenca[] = [];
    try {
      await transporte.atualizarClienteCampos(it.external_id, Object.fromEntries(pedidos));
    } catch (e) {
      if (!(e instanceof RecusadoPeloProvedor)) throw e;
      // um campo que o Asaas recusa não pode travar os outros: manda um a um
      for (const [k, v] of pedidos) {
        try {
          await transporte.atualizarClienteCampos(it.external_id, { [k]: v });
        } catch (e2) {
          if (!(e2 instanceof RecusadoPeloProvedor)) throw e2;
          recusados.push({ campo: k, lardan: v, asaas: antes[k] ?? null, acao: "recusado", nota: `O Asaas recusou: ${msg(e2)}` });
        }
      }
    }
    // confere de novo: só conta como enviado o que o Asaas devolveu igual ao Lardan
    const depois = paraDados(await transporte.lerClienteCompleto(it.external_id));
    const enviados: Record<string, { de: string | null; para: string | null }> = {};
    const naoConfirmados: Diferenca[] = [];
    for (const [k, v] of pedidos) {
      if (recusados.some((r) => r.campo === k)) continue;
      if (normalizar(k, depois[k]) === normalizar(k, v)) enviados[k] = { de: antes[k] ?? null, para: depois[k] ?? null };
      else naoConfirmados.push({ campo: k, lardan: v, asaas: depois[k] ?? null, acao: "enviar", nota: "O Asaas não confirmou a alteração." });
    }
    const c2 = comparar(it.lardan, depois, { ...opc, forcar: false });
    const difs = [...c2.diferencas.filter((x) => x.acao !== "enviar"), ...recusados, ...naoConfirmados];
    if (naoConfirmados.length) return fim("erro", difs, enviados, `O Asaas não confirmou: ${naoConfirmados.map((x) => x.campo).join(", ")}`);
    return fim(difs.length ? "diferente" : "atualizado", difs, enviados);
  } catch (e) {
    return fim("erro", [], {}, msg(e));
  }
}

export async function espelharClientes(d: DepsCliente) {
  const worker = d.worker ?? `cli-${crypto.randomUUID().slice(0, 8)}`;
  const itens = await d.servico.rpc<Item[]>("asaas_cliente_espelho_proximos", { _worker: worker, _limite: d.limite ?? 15, _party: d.party ?? null });
  const contas = new Map<string, Promise<TransporteCliente>>();
  const res: ResultadoCliente[] = [];
  for (const it of itens ?? []) {
    let t = contas.get(it.account_id);
    if (!t) { t = d.transporteConta(it.account_id); contas.set(it.account_id, t); }
    let transporte: TransporteCliente;
    try { transporte = await t; } catch (e) {
      res.push(await umCliente(d, worker, it, {}).then((r) => ({ ...r, erro: msg(e) })));
      continue;
    }
    res.push(await umCliente(d, worker, it, transporte));
  }
  const n = (e: string) => res.filter((r) => r.estado === e).length;
  return { processadas: res.length, atualizadas: n("atualizado"), iguais: n("igual"), diferentes: n("diferente"), erros: n("erro"), itens: res };
}

/** Produção: executor de serviço + transporte da conta Asaas de cada cliente. */
export async function espelharClientesProducao(o: { limite?: number; party?: string | null; actor?: string | null } = {}) {
  const { bancoExecutor, transporteDaConfiguracao } = await import("./servidor.server");
  type Config = Parameters<typeof transporteDaConfiguracao>[0];
  const servico = await bancoExecutor();
  return espelharClientes({
    servico, limite: o.limite, party: o.party ?? null, actor: o.actor ?? null,
    transporteConta: async (acc) =>
      (await transporteDaConfiguracao(await servico.rpc<Config>("asaas_exec_config", { _account: acc, _operacao: "link" }))) as unknown as TransporteCliente,
  });
}

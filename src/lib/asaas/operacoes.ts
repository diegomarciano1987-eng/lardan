/**
 * Percursos completos do servidor, com PREFLIGHT antes de qualquer efeito.
 * As ações do navegador (cobranca.functions / importacao.functions) só
 * delegam para cá; os testes isolados exercitam exatamente estes percursos.
 *
 * Conta indisponível (preparada, suspensa, incoerente, segredo ausente,
 * ambiente incompatível, saída externa desligada): nenhuma intenção, lote,
 * tentativa ou alteração de título/parcela/cobrança. Mensagem sanitizada.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS_EXECUTOR } from "./banco";
import { gerarLinkDeCobranca, type PedidoCobranca, type ResultadoCobranca } from "./cobranca";
import { abrirLote, buscarPaginas, gerarPrevia } from "./importacao";
import { resolverConta, transporteDaResolucao, type SituacaoBanco, type SituacaoPublica } from "./configuracao.server";
import type { TransporteAsaas } from "./contrato";
import type { Fetch } from "./transporte-http.server";

type Env = Record<string, string | undefined>;
export interface Dependencias {
  env: Env;
  /** somente testes: substitui a fábrica (ex.: simulador com falhas programadas) */
  transporte?: (accountId: string) => Promise<TransporteAsaas>;
  fetch?: Fetch;
  worker?: string;
  agora?: string;
}

export type Indisponivel = { state: "indisponivel"; situacao: SituacaoPublica; aviso: string; reaproveitada: false };

export async function solicitarCobranca(
  usuario: BancoAsaas,
  servico: BancoAsaas,
  actor: string,
  p: PedidoCobranca,
  d: Dependencias,
): Promise<ResultadoCobranca | Indisponivel> {
  const sit = await servico.rpc<SituacaoBanco>(ROTINAS_EXECUTOR.preflightParcela, { _installment: p.installmentId, _actor: actor });
  const r = resolverConta(sit, d.env);
  if (!r.executavel) return { state: "indisponivel", situacao: r.situacao, aviso: r.motivo, reaproveitada: false };
  const transporte = d.transporte ? await d.transporte(r.accountId) : await transporteDaResolucao(r, d.fetch ? { fetch: d.fetch } : {});
  return gerarLinkDeCobranca(usuario, servico, transporte, { installmentId: p.installmentId, billingType: p.billingType, ...(p.dueDate ? { dueDate: p.dueDate } : {}) }, {
    actor, contaEsperada: r.accountId, ...(d.worker ? { worker: d.worker } : {}), ...(d.agora ? { agora: d.agora } : {}),
  });
}

export async function importarComPreflight(
  usuario: BancoAsaas,
  servico: BancoAsaas,
  actor: string,
  pedido: { accountId: string; maxPaginas?: number; pageSize?: number; de?: string | null },
  d: Dependencias,
) {
  const sit = await servico.rpc<SituacaoBanco>(ROTINAS_EXECUTOR.preflightConta, { _account: pedido.accountId, _actor: actor, _cap: "finance.import.run" });
  const r = resolverConta(sit, d.env);
  if (!r.executavel) return { indisponivel: true as const, situacao: r.situacao, motivo: r.motivo };
  const transporte = d.transporte ? await d.transporte(r.accountId) : await transporteDaResolucao(r, d.fetch ? { fetch: d.fetch } : {});
  const p = { accountId: r.accountId, pageSize: pedido.pageSize ?? 50, incluirEmAbertoAnteriores: true,
    ...(pedido.de ? { de: pedido.de } : {}), ...(pedido.maxPaginas ? { maxPaginas: pedido.maxPaginas } : {}) };
  const lote = await abrirLote(usuario, p);
  const busca = await buscarPaginas(usuario, transporte, lote, p);
  return { indisponivel: false as const, lote, busca, previa: busca.hasMore ? null : await gerarPrevia(usuario, lote.run_id) };
}

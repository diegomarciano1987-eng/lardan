/**
 * Serviço de importação de recebíveis do Asaas.
 *
 * Fluxo: abrir lote → buscar páginas pelo adaptador → prévia → resolver
 * pendências → aprovar → efetivar → relatório.
 *
 * A prévia não cria título, parcela nem baixa. A efetivação usa as rotinas
 * canônicas do financeiro. Nada aqui gera caixa a partir de pagamento antigo.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS } from "./banco";
import type { CobrancaExterna, TransporteAsaas } from "./contrato";

export interface PedidoImportacao {
  accountId: string;
  kind?: "historica" | "sincronizacao";
  de?: string | null;
  ate?: string | null;
  pageSize?: number;
  /** traz dívidas anteriores ao recorte que continuam devidas */
  incluirEmAbertoAnteriores?: boolean;
  /** limite de páginas nesta rodada; o resto fica para a retomada */
  maxPaginas?: number;
}

export interface Lote {
  run_id: string;
  retomado: boolean;
  offset: number;
  page_size: number;
  has_more: boolean;
  simulado: boolean;
}

export async function abrirLote(banco: BancoAsaas, p: PedidoImportacao): Promise<Lote> {
  return banco.rpc<Lote>(ROTINAS.importarAbrir, {
    _account: p.accountId,
    _kind: p.kind ?? "historica",
    _de: p.de ?? null,
    _ate: p.ate ?? null,
    _page_size: p.pageSize ?? 50,
  });
}

export interface ResultadoBusca {
  runId: string;
  paginas: number;
  trazidos: number;
  novos: number;
  repetidos: number;
  hasMore: boolean;
  offset: number;
}

/** Percorre a paginação real do contrato. Interrompível e retomável. */
export async function buscarPaginas(
  banco: BancoAsaas,
  transporte: TransporteAsaas,
  lote: Lote,
  p: PedidoImportacao,
): Promise<ResultadoBusca> {
  let offset = lote.offset;
  let hasMore = true;
  let paginas = 0;
  let trazidos = 0;
  let novos = 0;
  let repetidos = 0;
  const limite = p.maxPaginas ?? Number.POSITIVE_INFINITY;

  while (hasMore && paginas < limite) {
    const pagina = await transporte.listarCobrancas({
      limit: lote.page_size,
      offset,
      dueDateGE: p.de ?? null,
      dueDateLE: p.ate ?? null,
      incluirEmAbertoAnteriores: p.incluirEmAbertoAnteriores ?? true,
    });

    const clientes = await coletarClientes(transporte, pagina.itens);
    const proximoOffset = pagina.proximoOffset ?? offset + pagina.quantidadeBruta;
    const r = await banco.rpc<{ novos: number; repetidos: number; offset: number; has_more: boolean }>(
      ROTINAS.importarPagina,
      {
        _run: lote.run_id,
        _offset: offset,
        _limit: pagina.limit,
        _raw_count: pagina.quantidadeBruta,
        _next_offset: proximoOffset,
        _itens: pagina.itens,
        _has_more: pagina.hasMore,
        _clientes: clientes,
      },
    );

    trazidos += pagina.itens.length;
    novos += r.novos;
    repetidos += r.repetidos;
    offset = proximoOffset;
    hasMore = pagina.hasMore;
    paginas += 1;
    if (pagina.quantidadeBruta === 0 && pagina.hasMore) {
      throw new Error("O provedor indicou continuação sem avançar o cursor.");
    }
  }

  return { runId: lote.run_id, paginas, trazidos, novos, repetidos, hasMore, offset };
}

async function coletarClientes(transporte: TransporteAsaas, itens: CobrancaExterna[]) {
  const ids = [...new Set(itens.map((i) => i.customer).filter(Boolean))];
  const achados = await Promise.all(ids.map((id) => transporte.consultarCliente(id)));
  return achados.filter(Boolean);
}

export interface Previa {
  run_id: string;
  total: number;
  resumo: Record<string, number>;
  pendencias: number;
  aviso: string;
}

export const gerarPrevia = (banco: BancoAsaas, runId: string) =>
  banco.rpc<Previa>(ROTINAS.importarPrevia, { _run: runId });

export const resolverPendencia = (
  banco: BancoAsaas,
  p: { stageId: string; acao: "ignorar" | "vincular" | "criar_titulo" | "so_espelho"; partyId?: string | null; titleId?: string | null; motivo?: string | null },
) =>
  banco.rpc(ROTINAS.importarResolver, {
    _stage: p.stageId,
    _acao: p.acao,
    _party: p.partyId ?? null,
    _title: p.titleId ?? null,
    _motivo: p.motivo ?? null,
  });

export const aprovarLote = (banco: BancoAsaas, runId: string, motivo?: string) =>
  banco.rpc<{ run_id: string; repetida: boolean; itens?: number }>(ROTINAS.importarAprovar, {
    _run: runId,
    _motivo: motivo ?? null,
  });

export interface RelatorioEfetivacao {
  run_id: string;
  titulos_criados: number;
  vinculados: number;
  somente_espelho: number;
  ignorados: number;
  aviso: string;
}

export const efetivarLote = (banco: BancoAsaas, runId: string, limite = 200) =>
  banco.rpc<RelatorioEfetivacao>(ROTINAS.importarEfetivar, { _run: runId, _limite: limite });

/** Percurso completo até a prévia (o passo humano de aprovar fica de fora de propósito). */
export async function importarAtePrevia(banco: BancoAsaas, transporte: TransporteAsaas, p: PedidoImportacao) {
  const lote = await abrirLote(banco, p);
  const busca = await buscarPaginas(banco, transporte, lote, p);
  const previa = busca.hasMore ? null : await gerarPrevia(banco, lote.run_id);
  return { lote, busca, previa };
}

/**
 * Leitura do painel de recebíveis Asaas — paginada no servidor.
 *
 * As rotinas vivem em db/pendentes/ e ainda NÃO foram aplicadas ao banco
 * compartilhado. Quando faltam, a tela diz isso em vez de quebrar.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CobrancaResumo {
  id: string;
  external_id: string | null;
  status: string | null;
  billing_type: string | null;
  invoice_url: string | null;
}

export interface IntencaoResumo {
  id: string;
  state: string;
  simulado: boolean;
  erro: string | null;
  fase: string | null;
}

export interface LinhaReceber {
  installment_id: string;
  account_id: string | null;
  title_id: string;
  numero: string | null;
  descricao: string | null;
  pessoa: string | null;
  vencimento: string;
  valor_cents: number;
  saldo_cents: number;
  settlement_status: string | null;
  cobranca: CobrancaResumo | null;
  intencao: IntencaoResumo | null;
}

/** Estado sanitizado da conta, resolvido no servidor (nunca contém segredo). */
export interface ContaAsaas {
  id: string;
  nome: string;
  situacao: "simulada" | "preparada" | "sandbox_configurado" | "producao_configurado" | "saida_desligada" | "credencial_ausente" | "conta_suspensa" | "indisponivel";
  rotulo: string;
  motivo: string;
  operacoes: { importar: boolean; cobrar: boolean; link: boolean; recuperar: boolean };
}

export interface FilaErro {
  id: string;
  state: string;
  erro: string | null;
  fase: string | null;
  attempts: number;
  installment_id: string;
  external_id: string | null;
  failure_class?: string | null;
  next_attempt_at?: string | null;
  pendencia_operacional?: boolean;
}

export interface Ocorrencia {
  id: string;
  event: string;
  status: string;
  classificacao: string;
  cobranca: string | null;
  quando: string;
  nota: string | null;
}

export type Cursor = Record<string, string> | null;
export interface PaginaDe<T> {
  itens: T[];
  proximo: Cursor;
  total?: number;
  limite: number;
}

export type SituacaoFiltro =
  | ""
  | "sem_cobranca"
  | "com_link"
  | "pendente_link"
  | "em_processamento"
  | "conciliacao"
  | "desconhecida"
  | "rejeitada";

export class PreparacaoNaoAplicada extends Error {
  constructor() {
    super("A preparação de recebíveis Asaas ainda não foi aplicada a este ambiente.");
    this.name = "PreparacaoNaoAplicada";
  }
}

async function chamar<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    const texto = `${error.message} ${error.hint ?? ""}`;
    if (/does not exist|could not find|schema cache/i.test(texto)) throw new PreparacaoNaoAplicada();
    throw new Error(error.message);
  }
  return data as T;
}

export const carregarParcelas = (f: { accountId?: string; busca?: string; situacao?: SituacaoFiltro; cursor?: Cursor; limite?: number }) =>
  chamar<PaginaDe<LinhaReceber>>("asaas_receber_parcelas", {
    _filtros: { account_id: f.accountId || null, busca: f.busca || null, situacao: f.situacao || null, cursor: f.cursor ?? null, limite: f.limite ?? 25 },
  });

export const carregarFila = (accountId?: string, cursor: Cursor = null) =>
  chamar<PaginaDe<FilaErro>>("asaas_receber_fila", { _filtros: { account_id: accountId || null, cursor, limite: 25 } });

export const carregarOcorrencias = (accountId?: string, cursor: Cursor = null) =>
  chamar<PaginaDe<Ocorrencia>>("asaas_receber_ocorrencias", { _filtros: { account_id: accountId || null, cursor, limite: 25 } });


export const AVISO_SIMULACAO = "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL";

export function situacaoCobranca(l: LinhaReceber): { rotulo: string; tom: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (l.intencao?.state === "desconhecida") return { rotulo: "Resultado desconhecido", tom: "danger" };
  if (l.intencao?.state === "conciliacao") return { rotulo: "Em conciliação", tom: "danger" };
  if (l.intencao?.state === "aguardando_retentativa") return { rotulo: "Aguardando nova tentativa", tom: "warning" };
  if (l.intencao?.state === "processando") return { rotulo: "Processando", tom: "warning" };
  if (l.cobranca?.invoice_url) return { rotulo: `Link disponível · ${l.cobranca.status ?? ""}`, tom: "info" };
  if (l.cobranca) return { rotulo: "Cobrança sem link — obter", tom: "warning" };
  if (l.intencao?.state === "rejeitada") return { rotulo: "Rejeitada", tom: "danger" };
  if (l.intencao?.state === "preparada") return { rotulo: "Preparada", tom: "warning" };
  return { rotulo: "Sem cobrança", tom: "neutral" };
}

export const FASES: Record<string, string> = {
  antes_do_provedor: "recusada antes de sair do servidor",
  cliente: "falha ao preparar o cliente (nenhuma cobrança enviada)",
  provedor_recusou: "o provedor recusou (nada criado)",
  sem_registro_apos_consulta: "provedor consultado: nada foi criado",
};

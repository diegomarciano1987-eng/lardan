/**
 * Leitura e ações do painel de recebíveis Asaas a partir da interface.
 *
 * As rotinas vivem em db/pendentes/ e ainda NÃO foram aplicadas ao banco
 * compartilhado. Quando faltam, a tela diz isso em bom português em vez de
 * quebrar: nada aqui escreve para "demonstrar".
 */
import { supabase } from "@/integrations/supabase/client";

export interface CobrancaResumo {
  id: string;
  external_id: string | null;
  status: string | null;
  billing_type: string | null;
}

export interface IntencaoResumo {
  id: string;
  state: string;
  invoice_url: string | null;
  simulado: boolean;
}

export interface LinhaReceber {
  installment_id: string;
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

export interface ContaAsaas {
  id: string;
  nome: string;
  ambiente: string;
  estado: string;
  conectada: boolean;
  empresa: string | null;
}

export interface FilaErro {
  id: string;
  state: string;
  erro: string | null;
  attempts: number;
  installment_id: string;
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

export interface PainelAsaas {
  itens: LinhaReceber[];
  fila_erros: FilaErro[];
  ocorrencias: Ocorrencia[];
  contas: ContaAsaas[];
}

/** Erro previsto: a preparação ainda não foi aplicada a este ambiente. */
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

export const carregarPainel = (limite = 50, deslocamento = 0) =>
  chamar<PainelAsaas>("asaas_receber_painel", { _filtros: { limit: limite, offset: deslocamento } });

export const prepararCobranca = (payload: {
  account_id: string;
  installment_id: string;
  billing_type: string;
  due_date?: string | null;
  criar_cliente?: boolean;
}) => chamar<{ id?: string; state?: string; invoice_url?: string | null; aviso?: string }>("asaas_cobranca_preparar", { _payload: payload });

export const AVISO_SIMULACAO = "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL";

export function situacaoCobranca(l: LinhaReceber): { rotulo: string; tom: "success" | "warning" | "danger" | "info" | "neutral" } {
  if (l.intencao?.state === "desconhecida") return { rotulo: "Resultado desconhecido", tom: "danger" };
  if (l.intencao?.state === "conciliacao") return { rotulo: "Em conciliação", tom: "danger" };
  if (l.intencao?.state === "rejeitada") return { rotulo: "Rejeitada", tom: "danger" };
  if (l.intencao?.state === "processando") return { rotulo: "Processando", tom: "warning" };
  if (l.cobranca?.status) return { rotulo: l.cobranca.status, tom: "info" };
  if (l.intencao?.state === "preparada") return { rotulo: "Preparada", tom: "warning" };
  return { rotulo: "Sem cobrança", tom: "neutral" };
}

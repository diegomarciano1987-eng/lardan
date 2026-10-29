/* ============================================================
 * FINANCEIRO DA FAMÍLIA — tipos e constantes
 * Módulo pessoal e independente (portado do sistema antigo):
 * NÃO importar nada dos módulos de negócio da Lardan (maletas,
 * cobrança, financeiro, pessoas...). Ver tests/isolado/familia-independencia.test.ts.
 * ============================================================ */

export type FormaPagamento = "debito" | "credito" | "pix" | "dinheiro" | "boleto" | "transferencia" | "vale";
export type TipoCategoria = "despesa" | "receita";
export type RecorrenciaFixa = "mensal" | "anual";
export type TipoConta = "conta_corrente" | "poupanca" | "carteira" | "cartao_credito" | "investimento" | "outro";
export type StatusOcorrencia = "paga" | "pulada";

/** Formas de pagamento: rótulo + cor (legível no tema claro e no escuro). */
export const FORMAS_PAGAMENTO: { valor: FormaPagamento; rotulo: string; cor: string }[] = [
  { valor: "debito", rotulo: "Débito", cor: "#0EA5E9" },
  { valor: "credito", rotulo: "Crédito", cor: "#F59E0B" },
  { valor: "pix", rotulo: "Pix", cor: "#14B8A6" },
  { valor: "dinheiro", rotulo: "Dinheiro", cor: "#22C55E" },
  { valor: "boleto", rotulo: "Boleto", cor: "#6366F1" },
  { valor: "transferencia", rotulo: "Transferência", cor: "#8B5CF6" },
  { valor: "vale", rotulo: "Vale (VR/VA)", cor: "#94A3B8" },
];

export const rotuloForma = (f: string | null | undefined) =>
  FORMAS_PAGAMENTO.find((x) => x.valor === f)?.rotulo ?? "—";
export const corForma = (f: string | null | undefined) =>
  FORMAS_PAGAMENTO.find((x) => x.valor === f)?.cor ?? "#94A3B8";

export const TIPOS_CONTA: { valor: TipoConta; rotulo: string }[] = [
  { valor: "conta_corrente", rotulo: "Conta corrente" },
  { valor: "poupanca", rotulo: "Poupança" },
  { valor: "carteira", rotulo: "Carteira / dinheiro" },
  { valor: "cartao_credito", rotulo: "Cartão de crédito" },
  { valor: "investimento", rotulo: "Investimento" },
  { valor: "outro", rotulo: "Outro" },
];

/** Paleta sugerida para novos cadastros (o usuário pode trocar). */
export const PALETA_CADASTRO = [
  "#0EA5E9", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899",
  "#14B8A6", "#6366F1", "#F97316", "#84CC16", "#64748B", "#A855F7",
];

export interface Categoria {
  id: string;
  nome: string;
  tipo: TipoCategoria;
  cor: string;
  ordem: number;
}

export interface Conta {
  id: string;
  nome: string;
  tipo: TipoConta;
  instituicao: string | null;
  cor: string;
  ativa: boolean;
}

export interface Projeto {
  id: string;
  nome: string;
  cor: string;
  ativo: boolean;
}

/** Regra de despesa fixa (as ocorrências mensais são calculadas pelo motor). */
export interface DespesaFixa {
  id: string;
  nome: string;
  valor: number;
  dia_vencimento: number;
  /** yyyy-MM-01 */
  mes_inicio: string;
  recorrencia: RecorrenciaFixa;
  parcelado: boolean;
  parcelas_total: number | null;
  categoria_id: string | null;
  forma_pagamento: FormaPagamento;
  projeto_id: string | null;
  conta_id: string | null;
  /** Último mês incluído (yyyy-MM-01) ou null se ativa. */
  encerrada_em: string | null;
  observacoes: string | null;
}

/** Marcação do usuário numa competência da despesa fixa. */
export interface RegistroOcorrencia {
  id: string;
  fixa_id: string;
  /** yyyy-MM-01 */
  competencia: string;
  status: StatusOcorrencia;
  valor_pago: number | null;
  data_pagamento: string | null;
}

export interface DespesaVariavel {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  recorrente: boolean;
  grupo_id: string | null;
  ocorrencia_numero: number | null;
  ocorrencias_total: number | null;
  categoria_id: string | null;
  forma_pagamento: FormaPagamento;
  projeto_id: string | null;
  conta_id: string | null;
  data_pagamento: string | null;
  observacoes: string | null;
}

export interface Receita {
  id: string;
  fonte: string;
  valor: number;
  data: string;
  recorrente: boolean;
  grupo_id: string | null;
  ocorrencia_numero: number | null;
  ocorrencias_total: number | null;
  categoria_id: string | null;
  forma_pagamento: FormaPagamento;
  observacoes: string | null;
}

export type EscopoEdicao = "esta" | "proximas";

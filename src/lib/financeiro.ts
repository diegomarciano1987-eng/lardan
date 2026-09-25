import { supabase } from "@/integrations/supabase/client";

/** Direção do título: a receber ou a pagar. */
export type FinDirection = "receivable" | "payable";

export type FinTitleStatus = "rascunho" | "submetido" | "aprovado" | "ativo" | "cancelado";

export const TITLE_STATUS_LABEL: Record<FinTitleStatus, string> = {
  rascunho: "Rascunho",
  submetido: "Submetido",
  aprovado: "Aprovado",
  ativo: "Ativo",
  cancelado: "Cancelado",
};

export interface FinOverview {
  periodo: { de: string; ate: string };
  a_receber_cents: number;
  a_pagar_cents: number;
  vencido_receber_cents: number;
  vencido_pagar_cents: number;
  proj30_receber_cents: number;
  proj30_pagar_cents: number;
  proj60_receber_cents: number;
  proj60_pagar_cents: number;
  proj90_receber_cents: number;
  proj90_pagar_cents: number;
  recebido_periodo_cents: number;
  pago_periodo_cents: number;
  saldo_contas_cents: number;
  titulos_pendentes_aprovacao: number;
}

export interface FinTitleRow {
  id: string;
  numero?: string | null;
  descricao: string;
  documento: string | null;
  status: FinTitleStatus;
  emissao: string;
  competencia: string | null;
  valor_cents: number;
  contraparte: string;
  proximo_vencimento: string | null;
  ultimo_vencimento?: string | null;
  vencimento_ref?: string | null;
  ultimo_pagamento?: string | null;
  quitado?: boolean;
  pago_cents: number;
  parcelas: number;
  chart_account_id?: string | null;
  cost_center_id?: string | null;
  business_entity_id?: string | null;
  payment_method_id?: string | null;
  financial_account_id?: string | null;
  plano_label?: string | null;
  centro_label?: string | null;
  entidade_label?: string | null;
  forma_label?: string | null;
  conta_label?: string | null;
  pendente_classificacao?: boolean;
  updated_at?: string;
}

export interface FinAccount {
  id: string;
  nome: string;
  kind: string;
  banco: string | null;
  is_active: boolean;
  saldo_cents: number;
  ultimo_movimento: string | null;
}

export interface FinInstallment {
  id: string;
  numero: number;
  total_parcelas: number;
  vencimento: string;
  valor_cents: number;
  settlement_status: "nao_liquidado" | "parcial" | "liquidado" | "excedente";
  pago_cents: number;
  ajustes_cents: number;
}

export interface FinTitleDetail {
  titulo: FinTitleRow & {
    observacao: string | null;
    origem: string;
    cancel_reason: string | null;
    direction: FinDirection;
  };
  pode_classificar?: boolean;
  parcelas: FinInstallment[];
  baixas: {
    id: string;
    data: string;
    valor_cents: number;
    conta: string | null;
    estorno: boolean;
    parcela: number;
    settlement_id: string;
  }[];
  reconhecimentos: {
    id: string;
    reconhecido_cents: number;
    contestado_cents: number;
    motivo: string | null;
    created_at: string;
  }[];
  eventos: {
    id: string;
    evento: string;
    motivo: string | null;
    created_at: string;
  }[];
}

/** Painel financeiro — todos os números vêm do servidor. */
export async function fetchFinOverview(): Promise<FinOverview> {
  const { data, error } = await supabase.rpc("fin_overview", {});
  if (error) throw error;
  return data as unknown as FinOverview;
}

export async function fetchFinAccounts(): Promise<FinAccount[]> {
  const { data, error } = await supabase.rpc("fin_accounts_overview");
  if (error) throw error;
  return (data as unknown as FinAccount[]) ?? [];
}

export interface FinTitleList {
  rows: FinTitleRow[];
  total: number;
  soma_cents: number;
  resumo?: { quitados: number; abertos: number; quitado_cents: number; aberto_cents: number };
}

export async function listFinTitles(params: {
  direction: FinDirection;
  search?: string;
  situacao?: string;
  limit: number;
  offset: number;
  chart?: string;
  centro?: string;
  entidade?: string;
  semClassificacao?: boolean;
  de?: string;
  ate?: string;
}): Promise<FinTitleList> {
  const args: Record<string, unknown> = {
    _direction: params.direction,
    _limit: params.limit,
    _offset: params.offset,
  };
  if (params.search) args["_search"] = params.search;
  if (params.situacao && params.situacao !== "todos") args["_situacao"] = params.situacao;
  if (params.de) args["_de"] = params.de;
  if (params.ate) args["_ate"] = params.ate;
  if (params.chart) args["_chart"] = params.chart;
  if (params.centro) args["_cc"] = params.centro;
  if (params.entidade) args["_entidade"] = params.entidade;
  if (params.semClassificacao) args["_sem_classificacao"] = true;
  const { data, error } = await supabase.rpc("fin_titles_list", args as never);
  if (error) throw error;
  return data as unknown as FinTitleList;
}

export async function fetchFinTitle(id: string): Promise<FinTitleDetail> {
  const { data, error } = await supabase.rpc("fin_title_detail", { _title: id });
  if (error) throw error;
  return data as unknown as FinTitleDetail;
}

export interface NovoTituloInput {
  direction: FinDirection;
  party_id: string;
  descricao: string;
  documento?: string;
  emissao?: string;
  competencia?: string;
  valor_cents: number;
  observacao?: string;
  business_entity_id?: string;
  chart_account_id?: string;
  cost_center_id?: string;
  payment_method_id?: string;
  financial_account_id?: string;
  parcelas: { vencimento: string; valor_cents: number }[];
}

export async function criarTitulo(input: NovoTituloInput): Promise<string> {
  const { data, error } = await supabase.rpc("fin_title_create", {
    _payload: input as unknown as never,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function cancelarTitulo(id: string, motivo: string) {
  const { error } = await supabase.rpc("fin_title_cancel", { _title: id, _motivo: motivo });
  if (error) throw error;
}

export async function registrarBaixa(input: {
  direction: FinDirection;
  financial_account_id: string;
  data?: string;
  valor_cents: number;
  referencia?: string;
  idempotency_key: string;
  alocacoes: { installment_id: string; valor_cents: number }[];
  tarifa_cents?: number;
  juros_cents?: number;
  desconto_cents?: number;
}): Promise<{ id: string; repetido: boolean; nao_alocado_cents: number }> {
  const { data, error } = await supabase.rpc("fin_settlement_create_ajustes" as never, {
    _payload: input as unknown as never,
  });
  if (error) throw error;
  return data as unknown as { id: string; repetido: boolean; nao_alocado_cents: number };
}

export async function estornarBaixa(settlementId: string, motivo: string) {
  const { error } = await supabase.rpc("fin_settlement_reverse", {
    _settlement: settlementId,
    _motivo: motivo,
  });
  if (error) throw error;
}

export async function transferirEntreContas(input: {
  from_account_id: string;
  to_account_id: string;
  valor_cents: number;
  data?: string;
  motivo?: string;
  idempotency_key: string;
}) {
  const { error } = await supabase.rpc("fin_transfer_create", {
    _payload: input as unknown as never,
  });
  if (error) throw error;
}

export async function registrarReconhecimento(
  titleId: string,
  reconhecido_cents: number,
  contestado_cents: number,
  motivo: string,
) {
  const { error } = await supabase.rpc("fin_acknowledge", {
    _title: titleId,
    _reconhecido: reconhecido_cents,
    _contestado: contestado_cents,
    _motivo: motivo,
  });
  if (error) throw error;
}

/** Contrapartes: sempre as pessoas/empresas já cadastradas, nunca cópias. */
export async function buscarContrapartes(
  termo: string,
): Promise<{ id: string; nome: string; hint: string }[]> {
  const args: { _limit: number; _offset: number; _search?: string } = {
    _limit: 20,
    _offset: 0,
  };
  if (termo) args._search = termo;
  const { data, error } = await supabase.rpc("list_parties", args);
  if (error) throw error;
  return (
    (data as {
      id: string;
      display_name: string | null;
      legal_name: string | null;
      code: string;
    }[]) ?? []
  ).map((p) => ({
    id: p.id,
    nome: p.display_name || p.legal_name || p.code,
    hint: p.code,
  }));
}

/** "1.234,56" → 123456 centavos. Nunca usa ponto flutuante na persistência. */
export function reaisParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Cadastro de conta ou caixa. O saldo inicial é marco auditado. */
export async function criarConta(input: {
  nome: string;
  kind: string;
  banco?: string;
  saldo_inicial_cents: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("fin_account_create", {
    _payload: input as unknown as never,
  });
  if (error) throw error;
  return data as unknown as string;
}

/* ===================== Departamento financeiro ===================== */

export interface FinAccountDetail {
  conta: {
    id: string;
    nome: string;
    apelido: string | null;
    kind: string;
    banco: string | null;
    agencia_masked: string | null;
    conta_masked: string | null;
    is_active: boolean;
    moeda: string | null;
    data_corte: string | null;
    entidade: string | null;
    saldo_inicial_cents: number;
    saldo_cents: number;
  };
  movimentos: {
    id: string;
    data: string;
    kind: string;
    valor_cents: number;
    descricao: string | null;
    created_at: string;
  }[];
  extratos: {
    id: string;
    competencia_inicio: string | null;
    competencia_fim: string | null;
    status: string;
    created_at: string;
  }[];
}

export async function fetchFinAccountDetail(id: string): Promise<FinAccountDetail> {
  const { data, error } = await supabase.rpc("fin_account_detail", { _account: id });
  if (error) throw error;
  return data as unknown as FinAccountDetail;
}

export async function fetchFinOverviewPeriodo(de?: string, ate?: string): Promise<FinOverview> {
  const args: { _de?: string; _ate?: string } = {};
  if (de) args._de = de;
  if (ate) args._ate = ate;
  const { data, error } = await supabase.rpc("fin_overview", args);
  if (error) throw error;
  return data as unknown as FinOverview;
}

export interface FinCashflowLinha {
  bucket: string;
  entradas_realizadas_cents: number;
  saidas_realizadas_cents: number;
  transferencias_cents: number;
  nao_classificado_entradas_cents: number;
  nao_classificado_saidas_cents: number;
  entradas_previstas_cents: number;
  saidas_previstas_cents: number;
  saldo_realizado_cents: number;
  saldo_projetado_cents: number;
}

export interface FinCashflow {
  periodo: { de: string; ate: string; agrupamento: string };
  saldo_abertura_cents: number;
  saldo_inicial_cents: number;
  filtros: {
    conta_id: string | null;
    centro_custo_id: string | null;
    entidade_id: string | null;
    classificacao_aplicada: boolean;
  };
  totais: {
    entradas_realizadas_cents: number;
    saidas_realizadas_cents: number;
    transferencias_cents: number;
    nao_classificado_entradas_cents: number;
    nao_classificado_saidas_cents: number;
    entradas_previstas_cents: number;
    saidas_previstas_cents: number;
    saldo_final_realizado_cents: number;
    saldo_final_projetado_cents: number;
  };
  linhas: FinCashflowLinha[];
}

export interface FiltrosCashflow {
  de: string;
  ate: string;
  agrupamento?: string;
  conta_id?: string;
  centro_custo_id?: string;
  entidade_id?: string;
}

export async function fetchFinCashflow(filtros: FiltrosCashflow): Promise<FinCashflow> {
  const { data, error } = await supabase.rpc("fin_cashflow", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as FinCashflow;
}

export type TipoDetalheFluxo =
  "realizado" | "transferencia" | "nao_classificado" | "previsto_entrada" | "previsto_saida";

export interface FinCashflowDetalhe {
  tipo: TipoDetalheFluxo;
  soma_cents: number;
  rows: {
    id: string;
    data: string;
    valor_cents: number;
    kind?: string;
    descricao: string | null;
    conta?: string | null;
    contraparte?: string | null;
    direction?: string;
  }[];
}

/** Lançamentos que compõem um valor do fluxo de caixa. */
export async function fetchFinCashflowDetalhe(
  filtros: FiltrosCashflow & { tipo: TipoDetalheFluxo },
): Promise<FinCashflowDetalhe> {
  const { data, error } = await supabase.rpc("fin_cashflow_detail", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as FinCashflowDetalhe;
}

export interface FinClassificacoes {
  planos: { id: string; codigo: string; nome: string; natureza: string }[];
  centros: { id: string; codigo: string; nome: string }[];
  entidades: { id: string; nome: string }[];
  formas: { id: string; codigo: string | null; nome: string }[];
  contas: { id: string; nome: string; kind: string }[];
}

/** Opções válidas de classificação, filtradas e buscadas no servidor. */
export async function fetchClassificacoes(filtros: {
  busca?: string;
  entidade_id?: string;
  direction?: FinDirection;
}): Promise<FinClassificacoes> {
  const { data, error } = await supabase.rpc("fin_classificacoes", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as FinClassificacoes;
}

/** Classificação posterior de um título já gravado, com histórico. */
export async function classificarTitulo(payload: {
  title_id: string;
  motivo?: string;
  esperado_updated_at?: string;
  business_entity_id?: string | null;
  chart_account_id?: string | null;
  cost_center_id?: string | null;
  payment_method_id?: string | null;
  financial_account_id?: string | null;
}): Promise<{ id: string; updated_at: string }> {
  const { data, error } = await supabase.rpc("fin_title_classify", {
    _payload: payload as unknown as never,
  });
  if (error) throw error;
  return data as unknown as { id: string; updated_at: string };
}

export interface FinChartRow {
  id: string;
  codigo: string;
  nome: string;
  natureza: string;
  parent_id: string | null;
  parent_label: string | null;
  aceita_lancamento: boolean;
  is_active: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  em_uso: boolean;
}

export async function listChartAccounts(filtros: {
  busca?: string;
  situacao?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; pode_gerenciar: boolean; rows: FinChartRow[] }> {
  const { data, error } = await supabase.rpc("fin_chart_list", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as { total: number; pode_gerenciar: boolean; rows: FinChartRow[] };
}

export async function salvarContaContabil(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc("fin_chart_save", {
    _payload: payload as unknown as never,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function alternarContaContabil(id: string, ativo: boolean) {
  const { error } = await supabase.rpc("fin_chart_toggle", { _id: id, _ativo: ativo });
  if (error) throw error;
}

export interface FinCostCenterRow {
  id: string;
  codigo: string;
  nome: string;
  parent_id: string | null;
  parent_label: string | null;
  entidade: string | null;
  responsavel: string | null;
  is_active: boolean;
  em_uso: boolean;
}

export async function listCostCenters(filtros: {
  busca?: string;
  situacao?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; pode_gerenciar: boolean; rows: FinCostCenterRow[] }> {
  const { data, error } = await supabase.rpc("fin_cost_center_list", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as { total: number; pode_gerenciar: boolean; rows: FinCostCenterRow[] };
}

export async function salvarCentroDeCusto(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc("fin_cost_center_save", {
    _payload: payload as unknown as never,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function alternarCentroDeCusto(id: string, ativo: boolean) {
  const { error } = await supabase.rpc("fin_cost_center_toggle", { _id: id, _ativo: ativo });
  if (error) throw error;
}

export interface FinPendingTitle {
  id: string;
  descricao: string;
  direction: FinDirection;
  documento: string | null;
  valor_cents: number;
  emissao: string;
  status: FinTitleStatus;
  contraparte: string;
  submetido_em: string | null;
}

export async function listTitulosPendentes(): Promise<{
  total: number;
  pode_decidir: boolean;
  rows: FinPendingTitle[];
}> {
  const { data, error } = await supabase.rpc("fin_titles_pending", { _limit: 100, _offset: 0 });
  if (error) throw error;
  return data as unknown as { total: number; pode_decidir: boolean; rows: FinPendingTitle[] };
}

export async function submeterTitulo(id: string) {
  const { error } = await supabase.rpc("fin_title_submit", { _title: id });
  if (error) throw error;
}

export async function aprovarTitulo(id: string, motivo?: string) {
  const { error } = await supabase.rpc("fin_title_approve", {
    _title: id,
    _motivo: motivo ?? "",
  });
  if (error) throw error;
}

export async function recusarTitulo(id: string, motivo: string) {
  const { error } = await supabase.rpc("fin_title_reject", { _title: id, _motivo: motivo });
  if (error) throw error;
}

export interface FinAuditRow {
  id: string;
  created_at: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  payload: unknown;
  autor: string;
}

export async function listFinAudit(filtros: {
  de?: string;
  ate?: string;
  acao?: string;
  busca?: string;
  limit?: number;
  offset?: number;
}): Promise<{ total: number; acoes: string[]; rows: FinAuditRow[] }> {
  const { data, error } = await supabase.rpc("fin_audit_list", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as { total: number; acoes: string[]; rows: FinAuditRow[] };
}

export interface FinSettings {
  pode_gerenciar: boolean;
  formas_pagamento: { id: string; codigo: string; nome: string; is_active: boolean }[];
  aprovacao: { regra: string; parametrizacao_por_valor: boolean };
  integracoes: { nome: string; status: string; observacao: string }[];
}

export async function fetchFinSettings(): Promise<FinSettings> {
  const { data, error } = await supabase.rpc("fin_settings_overview");
  if (error) throw error;
  return data as unknown as FinSettings;
}

export async function salvarFormaPagamento(payload: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.rpc("fin_payment_method_save", {
    _payload: payload as unknown as never,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function alternarFormaPagamento(id: string, ativo: boolean) {
  const { error } = await supabase.rpc("fin_payment_method_toggle", { _id: id, _ativo: ativo });
  if (error) throw error;
}

export interface FinDreLinha {
  natureza: string;
  chart_id: string;
  codigo: string;
  nome: string;
  valor_cents: number;
}

export interface FinDre {
  periodo: { de: string; ate: string; regime: "competencia" | "caixa" };
  fonte: string;
  linhas: FinDreLinha[];
  totais: {
    receita_bruta_cents: number;
    deducoes_cents: number;
    receita_liquida_cents: number;
    custos_cents: number;
    resultado_bruto_cents: number;
    despesas_cents: number;
    resultado_cents: number;
  };
  pendentes_classificacao: { quantidade: number; valor_cents: number };
}

export interface FiltrosDre {
  de: string;
  ate: string;
  regime: "competencia" | "caixa";
  centro_custo_id?: string;
  entidade_id?: string;
}

/** DRE gerencial — não é demonstração contábil nem fiscal oficial. */
export async function fetchFinDre(filtros: FiltrosDre): Promise<FinDre> {
  const { data, error } = await supabase.rpc("fin_dre", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as FinDre;
}

export async function fetchFinDreDetalhe(
  filtros: FiltrosDre & { chart_id?: string; sem_classificacao?: boolean },
): Promise<{
  soma_cents: number;
  rows: {
    id: string;
    data: string;
    descricao: string | null;
    contraparte: string;
    direction: string;
    valor_cents: number;
  }[];
}> {
  const { data, error } = await supabase.rpc("fin_dre_detalhe", {
    _filtros: filtros as unknown as never,
  });
  if (error) throw error;
  return data as unknown as {
    soma_cents: number;
    rows: {
      id: string;
      data: string;
      descricao: string | null;
      contraparte: string;
      direction: string;
      valor_cents: number;
    }[];
  };
}

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
  descricao: string;
  documento: string | null;
  status: FinTitleStatus;
  emissao: string;
  competencia: string | null;
  valor_cents: number;
  contraparte: string;
  proximo_vencimento: string | null;
  pago_cents: number;
  parcelas: number;
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

export async function listFinTitles(params: {
  direction: FinDirection;
  search?: string;
  situacao?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: FinTitleRow[]; total: number; soma_cents: number }> {
  const { data, error } = await supabase.rpc("fin_titles_list", {
    _direction: params.direction,
    _search: params.search || undefined,
    _status: undefined,
    _situacao:
      params.situacao && params.situacao !== "todos" ? params.situacao : undefined,
    _limit: params.limit,
    _offset: params.offset,
  });
  if (error) throw error;
  return data as unknown as { rows: FinTitleRow[]; total: number; soma_cents: number };
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
}): Promise<{ id: string; repetido: boolean; nao_alocado_cents: number }> {
  const { data, error } = await supabase.rpc("fin_settlement_create", {
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
  const { data, error } = await supabase.rpc("list_parties", {
    _search: termo || undefined,
    _kind: undefined,
    _role: undefined,
    _status: undefined,
    _limit: 20,
    _offset: 0,
  });
  if (error) throw error;
  return ((data as { id: string; display_name: string | null; legal_name: string | null; code: string }[]) ?? []).map(
    (p) => ({
      id: p.id,
      nome: p.display_name || p.legal_name || p.code,
      hint: p.code,
    }),
  );
}

/** "1.234,56" → 123456 centavos. Nunca usa ponto flutuante na persistência. */
export function reaisParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

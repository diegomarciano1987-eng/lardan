import { supabase } from "@/integrations/supabase/client";

async function rpc(f: string, a: Record<string, unknown>) {
  return (await supabase.rpc(f as never, a as never)) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
}

export interface ParcelaLinha {
  id: string;
  title_id: string;
  numero: number;
  total_parcelas: number;
  vencimento: string;
  valor_cents: number;
  saldo_cents: number;
  competencia: string;
  competencia_propria: boolean;
  situacao_baixa: string;
  descricao: string;
  titulo_numero: string | null;
  total_contrato_cents: number;
  contraparte: string;
  plano_label: string | null;
  natureza: string | null;
}

export interface ListaParcelas {
  rows: ParcelaLinha[];
  total: number;
  saldo_cents: number;
  valor_parcelas_cents: number;
  criterio: string;
}

export async function listarParcelas(p: {
  direction: "payable" | "receivable";
  de?: string;
  ate?: string;
  busca?: string;
  situacao?: string;
  limit: number;
  offset: number;
}): Promise<ListaParcelas> {
  const { data, error } = await rpc("fin_installments_list", {
    _direction: p.direction,
    _de: p.de ?? null,
    _ate: p.ate ?? null,
    _search: p.busca || null,
    _situacao: p.situacao ?? null,
    _limit: p.limit,
    _offset: p.offset,
  });
  if (error) throw new Error(error.message);
  return data as ListaParcelas;
}

export interface TransferenciaOperacao {
  id: string;
  data: string;
  valor_cents: number;
  de: string;
  para: string;
  motivo: string | null;
  estorno: boolean;
  implantacao: boolean;
  movimentos: { id: string; conta: string; valor_cents: number; kind: string }[] | null;
}

export interface ListaTransferencias {
  rows: TransferenciaOperacao[];
  operacional_cents: number;
  implantacao_cents: number;
  criterio: string;
}

export async function listarTransferencias(de: string, ate: string): Promise<ListaTransferencias> {
  const { data, error } = await rpc("fin_transfers_list", { _de: de, _ate: ate });
  if (error) throw new Error(error.message);
  return data as ListaTransferencias;
}

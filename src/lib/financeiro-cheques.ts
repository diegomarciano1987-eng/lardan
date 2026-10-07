import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = (await supabase.rpc(f as never, a as never)) as unknown as {
    data: T;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  return data;
}

export type StatusCheque = "em_maos" | "repassado" | "depositado" | "compensado" | "devolvido" | "cancelado";

export const STATUS_CHEQUE: Record<StatusCheque, string> = {
  em_maos: "Em mãos",
  repassado: "Repassado",
  depositado: "Depositado",
  compensado: "Compensado",
  devolvido: "Devolvido",
  cancelado: "Cancelado",
};

export interface Cheque {
  id: string;
  numero: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  emitente_nome: string;
  emitente_doc: string | null;
  recebido_de: string | null;
  valor_cents: number;
  bom_para: string;
  recebido_em: string;
  status: StatusCheque;
  repassado_para: string | null;
  conta_deposito: string | null;
  observacao: string | null;
  eventos: { de: string | null; para: string; motivo: string | null; quando: string }[];
}

export interface ListaCheques {
  resumo: Partial<Record<StatusCheque, { qtd: number; total_cents: number }>>;
  linhas: Cheque[];
}

export const fetchCheques = (status: string | null, q: string | null) =>
  rpc<ListaCheques>("fin_cheques_lista", { _status: status, _q: q });

export const registrarCheque = (payload: Record<string, unknown>) =>
  rpc<string>("fin_cheque_registrar", { _payload: payload });

export const mudarCheque = (id: string, para: StatusCheque, payload: Record<string, unknown>) =>
  rpc<null>("fin_cheque_mudar", { _id: id, _para: para, _payload: payload });

export interface FatiasConta {
  saldo_cents: number;
  reservado_cents: number;
  fatias: { party_id: string; nome: string; valor_cents: number }[];
  historico: { nome: string; valor_cents: number; data: string; motivo: string; quando: string }[];
}

export const fetchFatias = (accountId: string) =>
  rpc<FatiasConta>("fin_fatias_conta", { _account: accountId });

export const lancarFatia = (payload: Record<string, unknown>) =>
  rpc<string>("fin_fatia_lancar", { _payload: payload });

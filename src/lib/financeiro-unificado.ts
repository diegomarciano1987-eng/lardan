import { supabase } from "@/integrations/supabase/client";

export type Natureza = "todos" | "receber" | "pagar";

export interface LinhaPR {
  id: string;
  tipo: "parcela" | "cobranca_asaas";
  direction: "receivable" | "payable";
  origem: string;
  pessoa: string | null;
  descricao: string;
  titulo_numero: string | null;
  numero: number | null;
  total_parcelas: number | null;
  vencimento: string;
  competencia: string;
  valor_cents: number;
  ajustes_cents: number;
  liquidado_cents: number;
  saldo_cents: number;
  situacao: "aberto" | "vencido" | "quitado" | "recebido_asaas" | "a_vincular";
  conta_prevista: string | null;
  conta_liquidacao: string | null;
  title_id: string | null;
  external_id: string | null;
  invoice_url: string | null;
  status_externo: string | null;
}

interface Bloco {
  qtd: number;
  valor_cents: number;
  liquidado_cents: number;
  saldo_cents: number;
}

export interface RespostaPR {
  rows: LinhaPR[];
  totais: {
    linhas: number;
    receber: Bloco;
    pagar: Bloco;
    asaas_a_vincular: {
      qtd: number;
      valor_cents: number;
      clientes: number;
      aberto_qtd: number;
      aberto_cents: number;
      recebido_qtd: number;
      recebido_cents: number;
      clientes_aberto: number;
    };
  };
  periodo: { de: string; ate: string; corte: string };
  criterio: string;
}

export interface FiltrosPR {
  natureza: Natureza;
  de: string;
  ate: string;
  situacao: string;
  origem: string;
  busca: string;
  limit: number;
  offset: number;
}

export async function fetchPagarReceber(f: FiltrosPR): Promise<RespostaPR> {
  const { data, error } = await supabase.rpc("fin_pagar_receber" as never, {
    _natureza: f.natureza,
    _de: f.de,
    _ate: f.ate,
    _situacao: f.situacao,
    _origem: f.origem,
    _search: f.busca || null,
    _limit: f.limit,
    _offset: f.offset,
  } as never);
  if (error) throw new Error((error as { message: string }).message);
  return data as unknown as RespostaPR;
}

export interface LinhaLiquidacao {
  id: string;
  data: string;
  valor_cents: number;
  is_reversal: boolean;
  referencia: string | null;
  conta: string | null;
  descricao: string | null;
  pessoa: string | null;
}

export async function fetchLiquidacoes(p: {
  direction: "receivable" | "payable";
  de: string;
  ate: string;
  limit: number;
  offset: number;
}): Promise<{ rows: LinhaLiquidacao[]; total: number; soma_cents: number; criterio: string }> {
  const { data, error } = await supabase.rpc("fin_liquidacoes_list" as never, {
    _direction: p.direction,
    _de: p.de,
    _ate: p.ate,
    _limit: p.limit,
    _offset: p.offset,
  } as never);
  if (error) throw new Error((error as { message: string }).message);
  return data as never;
}

export async function fetchUltimaSyncAsaas() {
  const { data, error } = await supabase
    .from("asaas_charge_sync_runs" as never)
    .select("status, iniciado_em, concluido_em, recebidas, inseridas, atualizadas, erro, de, ate")
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as null | {
    status: string;
    iniciado_em: string;
    concluido_em: string | null;
    recebidas: number;
    inseridas: number;
    atualizadas: number;
    erro: string | null;
    de: string;
    ate: string;
  };
}

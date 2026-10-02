import { supabase } from "@/integrations/supabase/client";

export type Comparativo = "mes_anterior" | "ano_anterior" | "orcado";

export interface FiltrosDreGerencial {
  de: string;
  ate: string;
  regime: "competencia" | "caixa";
  centro_custo_id?: string;
  entidade_id?: string;
  comparativo: Comparativo;
}

export interface DreConta {
  chart_id: string;
  codigo: string;
  nome: string;
  valores: Record<string, number>;
  total: number;
}

export interface DreLinhaG {
  codigo: string;
  rotulo: string;
  tipo: "grupo" | "subtotal" | "indicador";
  sinal: 1 | -1;
  ordem: number;
  valores: Record<string, number>;
  comparativo: Record<string, number>;
  pct_receita: Record<string, number | null> | null;
  total: number;
  total_comparativo: number;
  pct_receita_total: number | null;
  contas: DreConta[];
}

export interface DreAlerta {
  codigo: string;
  rotulo: string;
  mes: string;
  valor_cents: number;
  media3_cents: number;
  desvio_cents: number;
  variacao_pct: number;
  pior: boolean;
}

export interface DreGerencial {
  periodo: { de: string; ate: string; regime: string; comparativo: Comparativo; data_corte: string };
  versao_estrutura: number;
  meses: string[];
  meses_fechados: string[];
  linhas: DreLinhaG[];
  alertas: DreAlerta[];
  indicadores_lardan: {
    receita_liquida_cents: number;
    comissoes_cents: number;
    tarifas_asaas_cents: number;
    custo_cobranca_cents: number;
    recebido_cents: number;
    inadimplencia_representante: null;
    inadimplencia_nota: string;
  };
}

/** Matriz gerencial (linhas × meses). Lucro líquido = fin_dre no mesmo filtro. */
export async function fetchDreGerencial(f: FiltrosDreGerencial): Promise<DreGerencial> {
  const { data, error } = await supabase.rpc("fin_dre_gerencial", { _filtros: f as unknown as never });
  if (error) throw error;
  return data as unknown as DreGerencial;
}

export interface Periodo {
  mes: string;
  business_entity_id: string | null;
  situacao: "aberto" | "fechado";
  fechado_em: string | null;
  motivo: string | null;
}

export async function fetchPeriodos(): Promise<Periodo[]> {
  const { data, error } = await supabase
    .from("fin_periodos")
    .select("mes, business_entity_id, situacao, fechado_em, motivo")
    .order("mes", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Periodo[];
}

export async function fecharPeriodo(mes: string, motivo: string, ent: string | null = null) {
  const { error } = await supabase.rpc("fin_periodo_fechar", { _mes: mes, _ent: ent as never, _motivo: motivo });
  if (error) throw error;
}

export async function reabrirPeriodo(mes: string, motivo: string, ent: string | null = null) {
  const { error } = await supabase.rpc("fin_periodo_reabrir", { _mes: mes, _ent: ent as never, _motivo: motivo });
  if (error) throw error;
}

export async function mapearConta(chartId: string, linha: string | null) {
  const { error } = await supabase.rpc("fin_dre_mapa_set", { _chart: chartId, _linha: (linha ?? "") as never });
  if (error) throw error;
}

export interface LinhaOrcamento {
  mes: string;
  linha: string;
  valor_cents: number;
  chart_id?: string;
  cost_center_id?: string;
}

export async function salvarOrcamento(linhas: LinhaOrcamento[], origem: "tela" | "planilha") {
  const { data, error } = await supabase.rpc("fin_orcamento_salvar", {
    _linhas: linhas as unknown as never,
    _origem: origem,
  });
  if (error) throw error;
  return data as unknown as { gravadas: number };
}

export const nomeMes = (ym: string, curto = true) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
  const s = d.toLocaleDateString("pt-BR", curto ? { month: "short", year: "2-digit" } : { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(".", "");
};

export const fimDoMes = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

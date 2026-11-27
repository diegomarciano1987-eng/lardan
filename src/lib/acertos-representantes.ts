/**
 * Acertos dos representantes (0410) — modelo da planilha COMERCIAL 2026.
 * O servidor (rep_acerto_calculo) é a fonte oficial; este motor puro só dá a prévia ao digitar,
 * com as MESMAS regras: tabela vigente pela data, faixa pelo % de recebimento (recebimento ÷ venda líquida),
 * comissão = % × recebimento, diferença = recebimento − total pago, livre = comissão − diferença − retido − desconto.
 */
import { supabase } from "@/integrations/supabase/client";

export type Faixa = { nome: string; min: number; pct: number };
export type TabelaComissao = { id: string; nome: string; vigente_de: string; faixas: Faixa[] };
export type ConfigRetencao = { retencao_pct: number; retencao_desde: string | null };

export type AcertoBase = {
  id?: string;
  representante_party_id: string;
  data: string;
  praca: string;
  responsavel_nome?: string | null;
  clientes_atendidas: number | null;
  aberturas: number | null;
  cortes: number | null;
  nao_atendidas: number | null;
  estoque_enviado_cents: number | null;
  venda_bruta_cents: number | null;
  venda_liquida_cents: number | null;
  recebimento_cents: number | null;
  total_pago_cents: number | null;
  combustivel_cents: number;
  hotel_cents: number;
  alimentacao_cents: number;
  outros_cents: number;
  retido_cents: number | null;
  desconto_pessoal_cents: number;
  observacao?: string | null;
};

export type Calculo = {
  tabela: string | null;
  pct_recebimento: number | null;
  faixa: string | null;
  pct_comissao: number;
  comissao_cents: number;
  gastos_cents: number;
  diferenca_cents: number;
  retido_calc_cents: number;
  retido_automatico: boolean;
  carteira: number;
  aproveitamento: number | null;
  ticket_bruto_cents: number | null;
  ticket_liquido_cents: number | null;
  livre_cents: number;
};

export type AcertoLinha = AcertoBase & Calculo & { id: string; rep_nome: string; origem: "manual" | "planilha" };

export function tabelaVigente(tabelas: TabelaComissao[], data: string): TabelaComissao | null {
  let t: TabelaComissao | null = null;
  for (const x of [...tabelas].sort((a, b) => a.vigente_de.localeCompare(b.vigente_de))) if (x.vigente_de <= data) t = x;
  return t;
}

export function calcularAcerto(a: AcertoBase, tabelas: TabelaComissao[], cfg: ConfigRetencao | null): Calculo {
  const t = tabelaVigente(tabelas, a.data);
  const liq = a.venda_liquida_cents ?? 0;
  const pctRec = liq > 0 ? (a.recebimento_cents ?? 0) / liq : null;
  let faixa: string | null = null;
  let pct = 0;
  if (t && pctRec !== null) {
    for (const f of [...t.faixas].sort((x, y) => x.min - y.min)) if (pctRec >= f.min) { faixa = f.nome; pct = f.pct; }
  }
  const comissao = Math.round(pct * (a.recebimento_cents ?? 0));
  const gastos = a.combustivel_cents + a.hotel_cents + a.alimentacao_cents + a.outros_cents;
  const dif = (a.recebimento_cents ?? 0) - (a.total_pago_cents ?? 0);
  const autoRet = cfg?.retencao_desde && a.data >= cfg.retencao_desde ? Math.round(comissao * Number(cfg.retencao_pct)) : 0;
  const ret = a.retido_cents ?? autoRet;
  const at = a.clientes_atendidas ?? 0;
  return {
    tabela: t?.nome ?? null,
    pct_recebimento: pctRec,
    faixa,
    pct_comissao: pct,
    comissao_cents: comissao,
    gastos_cents: gastos,
    diferenca_cents: dif,
    retido_calc_cents: ret,
    retido_automatico: a.retido_cents === null,
    carteira: at + (a.nao_atendidas ?? 0),
    aproveitamento: (a.estoque_enviado_cents ?? 0) > 0 ? (a.venda_bruta_cents ?? 0) / (a.estoque_enviado_cents ?? 1) : null,
    ticket_bruto_cents: at > 0 ? Math.round((a.venda_bruta_cents ?? 0) / at) : null,
    ticket_liquido_cents: at > 0 ? Math.round((a.venda_liquida_cents ?? 0) / at) : null,
    livre_cents: comissao - dif - ret - a.desconto_pessoal_cents,
  };
}

export type Painel = {
  pode_editar: boolean;
  representantes: { id: string; nome: string; codigo: string | null }[];
  linhas: AcertoLinha[];
  tabelas: TabelaComissao[];
  config: ConfigRetencao | null;
};

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome as never, args as never);
  if (error) throw error;
  return data as T;
}
export const painelAcertos = (rep: string | null, ano: number | null) => rpc<Painel>("rep_acertos_lista", { _rep: rep, _ano: ano });
export const salvarAcerto = (d: AcertoBase) => rpc<string>("rep_acerto_salvar", { _d: d });
export const excluirAcerto = (id: string, motivo: string) => rpc<null>("rep_acerto_excluir", { _id: id, _motivo: motivo });
export type RemessaOperacao = { remessa: number; praca: string; data_acerto: string; maletas: number; estoque_enviado_cents: number; baixas_fechadas: number; vendido_cents: number; sem_maleta: number };
export const operacaoDoAcerto = (rep: string, data: string) => rpc<RemessaOperacao[]>("rep_acerto_operacao", { _rep: rep, _data: data });

export const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/**
 * 0180 — Histórico de vendas e Objetivo de venda da consultora.
 * Tudo vem calculado do banco (consultora_historico_vendas): a tela só mostra.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MesObjetivo = { mes: string; acerto: boolean; vendido_cents: number | null; comissao_cents: number | null; estimada: boolean };
export type Objetivo = {
  tipo: "meta" | "objetivo";
  objetivo_cents: number | null;
  minimo_cents?: number | null;
  media_cents?: number;
  piso: boolean;
  meses_com_acerto: number;
  comissao_objetivo_cents: number | null;
  percentual_objetivo?: number;
  meses: MesObjetivo[];
};
export type MaletaVendida = { origem: "antigo" | "lardan"; remessa: number | null; data: string; vendido_cents: number; comissao_cents: number; estimada: boolean; kits: number; pecas_vendidas: number };
export type MesVendas = { mes: string; vendido_cents: number; comissao_cents: number; estimada: boolean; acertos: number; maletas: MaletaVendida[] };
export type HistoricoVendas = {
  resumo: { vendido_cents: number; comissao_cents: number; acertos: number; primeiro_acerto: string | null; melhor_mes: { mes: string; vendido_cents: number } | null };
  meses: MesVendas[];
  objetivo: Objetivo | null;
  objetivo_da_maleta: boolean;
};

export const historicoVendasQuery = () => queryOptions({
  queryKey: ["consultora", "historico-vendas"],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_historico_vendas" as never);
    if (error) throw error;
    return data as unknown as HistoricoVendas;
  },
});

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/** "2026-08" → "Agosto de 2026" */
export const mesLongo = (ym: string) => { const n = MESES[Number(ym.slice(5, 7)) - 1] ?? ""; return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${ym.slice(0, 4)}`; };
/** "2026-08" → "Ago/26" */
export const mesCurto = (ym: string) => `${MESES_CURTOS[Number(ym.slice(5, 7)) - 1] ?? ""}/${ym.slice(2, 4)}`;

/** Últimos 12 meses (até o mês atual), com zero onde não houve acerto: barras contínuas no gráfico. */
export function ultimos12(meses: MesVendas[], hoje = new Date()) {
  const por = new Map(meses.map((m) => [m.mes, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 11 + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = por.get(ym);
    return { mes: ym, rotulo: mesCurto(ym), vendido: (m?.vendido_cents ?? 0) / 100, comissao: (m?.comissao_cents ?? 0) / 100 };
  });
}

/** Meses agrupados por ano, mais recente primeiro, com o total de cada ano. */
export function porAno(meses: MesVendas[]) {
  const anos = new Map<string, MesVendas[]>();
  for (const m of meses) anos.set(m.mes.slice(0, 4), [...(anos.get(m.mes.slice(0, 4)) ?? []), m]);
  return [...anos.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([ano, ms]) => ({
    ano, meses: [...ms].sort((a, b) => b.mes.localeCompare(a.mes)),
    vendido_cents: ms.reduce((s, m) => s + Number(m.vendido_cents), 0),
    comissao_cents: ms.reduce((s, m) => s + Number(m.comissao_cents), 0),
  }));
}

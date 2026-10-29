/* ============================================================
 * FINANCEIRO DA FAMÍLIA — motor de cálculo (funções puras)
 *
 * Tudo que é número na tela sai daqui. Sem React, sem banco:
 * fácil de testar (tests/isolado/familia-motor.test.ts) e impossível de divergir
 * entre cards, abas, gráficos e relatório anual.
 *
 * Regime: COMPETÊNCIA. A despesa conta no mês em que vence
 * (fixas) ou na data do lançamento (variáveis/receitas),
 * esteja paga ou não. "Pago / em aberto" é só controle.
 * ============================================================ */
import { addMonthsYM, diffMonthsYM, ultimoDiaDoMes } from "./datas";
import type { DespesaFixa, DespesaVariavel, Receita, RegistroOcorrencia } from "./tipos";

const pad2 = (n: number) => String(n).padStart(2, "0");
const ym = (iso: string) => iso.slice(0, 7);
/** Soma em centavos para não acumular erro de ponto flutuante. */
const somar = (valores: number[]) => Math.round(valores.reduce((s, v) => s + Math.round(Number(v) * 100), 0)) / 100;

export type StatusLinha = "pago" | "a_pagar" | "pulada";

export interface OcorrenciaFixa {
  /** `${fixa_id}:${yyyy-MM}` — estável para keys/React. */
  chave: string;
  fixa: DespesaFixa;
  /** yyyy-MM */
  mes: string;
  /** yyyy-MM-01 (gravado em familia_fixas_ocorrencias.competencia) */
  competencia: string;
  /** Vencimento real: dia escolhido, limitado ao último dia do mês. */
  vencimento: string;
  /** Valor que conta no mês: pago (se registrado) ou previsto. Pulada = 0. */
  valor: number;
  valor_previsto: number;
  status: StatusLinha;
  registro: RegistroOcorrencia | null;
  /** Para parceladas: 3 de 12. */
  parcela: { numero: number; total: number } | null;
}

/** Índice da ocorrência da regra no mês (0 = primeira) ou null se não ocorre. */
export function indiceOcorrencia(fixa: DespesaFixa, mes: string): number | null {
  const inicio = ym(fixa.mes_inicio);
  const delta = diffMonthsYM(inicio, mes);
  if (delta < 0) return null;
  if (fixa.encerrada_em && mes > ym(fixa.encerrada_em)) return null;
  let indice: number;
  if (fixa.recorrencia === "anual") {
    if (delta % 12 !== 0) return null;
    indice = delta / 12;
  } else {
    indice = delta;
  }
  if (fixa.parcelado) {
    const total = fixa.parcelas_total ?? 0;
    if (indice >= total) return null;
  }
  return indice;
}

export function vencimentoNoMes(mes: string, dia: number): string {
  const y = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return `${mes}-${pad2(Math.min(Math.max(1, dia), ultimoDiaDoMes(y, m)))}`;
}

/** Último mês em que a regra gera ocorrência (null = sem fim). */
export function ultimoMesDaRegra(fixa: DespesaFixa): string | null {
  const inicio = ym(fixa.mes_inicio);
  let fim: string | null = fixa.encerrada_em ? ym(fixa.encerrada_em) : null;
  if (fixa.parcelado && fixa.parcelas_total) {
    const passo = fixa.recorrencia === "anual" ? 12 : 1;
    const ultimaParcela = addMonthsYM(inicio, (fixa.parcelas_total - 1) * passo);
    fim = fim && fim < ultimaParcela ? fim : ultimaParcela;
  }
  return fim;
}

/** Gera as ocorrências das despesas fixas entre dois meses (inclusive). */
export function gerarOcorrenciasFixas(
  regras: DespesaFixa[],
  registros: RegistroOcorrencia[],
  deMes: string,
  ateMes: string,
): OcorrenciaFixa[] {
  const porChave = new Map<string, RegistroOcorrencia>();
  for (const r of registros) porChave.set(`${r.fixa_id}:${ym(r.competencia)}`, r);

  const meses: string[] = [];
  for (let m = ym(deMes); m <= ym(ateMes); m = addMonthsYM(m, 1)) meses.push(m);

  const out: OcorrenciaFixa[] = [];
  for (const fixa of regras) {
    for (const mes of meses) {
      const idx = indiceOcorrencia(fixa, mes);
      if (idx === null) continue;
      const chave = `${fixa.id}:${mes}`;
      const registro = porChave.get(chave) ?? null;
      const previsto = Number(fixa.valor);
      let status: StatusLinha = "a_pagar";
      let valor = previsto;
      if (registro?.status === "paga") {
        status = "pago";
        valor = Number(registro.valor_pago ?? previsto);
      } else if (registro?.status === "pulada") {
        status = "pulada";
        valor = 0;
      }
      out.push({
        chave,
        fixa,
        mes,
        competencia: `${mes}-01`,
        vencimento: vencimentoNoMes(mes, fixa.dia_vencimento),
        valor,
        valor_previsto: previsto,
        status,
        registro,
        parcela: fixa.parcelado && fixa.parcelas_total ? { numero: idx + 1, total: fixa.parcelas_total } : null,
      });
    }
  }
  return out.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.fixa.nome.localeCompare(b.fixa.nome));
}

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */

export interface Filtros {
  busca?: string;
  categoria_id?: string | null;
  projeto_id?: string | null;
  conta_id?: string | null;
  forma_pagamento?: string | null;
}

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function casaTexto(texto: string, busca?: string) {
  if (!busca || !busca.trim()) return true;
  return normalizar(texto).includes(normalizar(busca));
}

export function filtrarFixas(oc: OcorrenciaFixa[], f: Filtros): OcorrenciaFixa[] {
  return oc.filter((o) =>
    casaTexto(o.fixa.nome, f.busca)
    && (!f.categoria_id || o.fixa.categoria_id === f.categoria_id)
    && (!f.projeto_id || o.fixa.projeto_id === f.projeto_id)
    && (!f.conta_id || o.fixa.conta_id === f.conta_id)
    && (!f.forma_pagamento || o.fixa.forma_pagamento === f.forma_pagamento));
}

export function filtrarVariaveis(v: DespesaVariavel[], f: Filtros): DespesaVariavel[] {
  return v.filter((d) =>
    casaTexto(`${d.descricao} ${d.observacoes ?? ""}`, f.busca)
    && (!f.categoria_id || d.categoria_id === f.categoria_id)
    && (!f.projeto_id || d.projeto_id === f.projeto_id)
    && (!f.conta_id || d.conta_id === f.conta_id)
    && (!f.forma_pagamento || d.forma_pagamento === f.forma_pagamento));
}

/** Receitas não têm projeto/conta: esses filtros não as escondem. */
export function filtrarReceitas(r: Receita[], f: Filtros): Receita[] {
  return r.filter((x) =>
    casaTexto(`${x.fonte} ${x.observacoes ?? ""}`, f.busca)
    && (!f.categoria_id || x.categoria_id === f.categoria_id)
    && (!f.forma_pagamento || x.forma_pagamento === f.forma_pagamento));
}

/* ------------------------------------------------------------------ */
/* Resumos                                                             */
/* ------------------------------------------------------------------ */

export interface ResumoMes {
  mes: string;
  receitas: number;
  despesasFixas: number;
  despesasVariaveis: number;
  despesas: number;
  saldo: number;
  /** % do que entrou que sobrou (null quando não houve receita). */
  economiaPct: number | null;
  pago: number;
  emAberto: number;
  qtdFixasPagas: number;
  qtdFixas: number;
}

export interface DadosMes {
  fixas: OcorrenciaFixa[];
  variaveis: DespesaVariavel[];
  receitas: Receita[];
}

export function resumirMes(mes: string, d: DadosMes): ResumoMes {
  const fixasDoMes = d.fixas.filter((o) => o.mes === mes && o.status !== "pulada");
  const varDoMes = d.variaveis.filter((v) => ym(v.data) === mes);
  const recDoMes = d.receitas.filter((r) => ym(r.data) === mes);

  const receitas = somar(recDoMes.map((r) => r.valor));
  const despesasFixas = somar(fixasDoMes.map((o) => o.valor));
  const despesasVariaveis = somar(varDoMes.map((v) => v.valor));
  const despesas = somar([despesasFixas, despesasVariaveis]);
  const saldo = somar([receitas, -despesas]);

  const pago = somar([
    ...fixasDoMes.filter((o) => o.status === "pago").map((o) => o.valor),
    ...varDoMes.filter((v) => !!v.data_pagamento).map((v) => v.valor),
  ]);
  return {
    mes,
    receitas,
    despesasFixas,
    despesasVariaveis,
    despesas,
    saldo,
    economiaPct: receitas > 0 ? Math.round((saldo / receitas) * 1000) / 10 : null,
    pago,
    emAberto: somar([despesas, -pago]),
    qtdFixasPagas: fixasDoMes.filter((o) => o.status === "pago").length,
    qtdFixas: fixasDoMes.length,
  };
}

/** Série de N meses terminando em `ateMes` (para gráfico). */
export function serieMensal(ateMes: string, quantidade: number, d: DadosMes): ResumoMes[] {
  const out: ResumoMes[] = [];
  for (let i = quantidade - 1; i >= 0; i--) out.push(resumirMes(addMonthsYM(ateMes, -i), d));
  return out;
}

/** Remove meses vazios do início, mas preserva o mês final quando ainda não há movimentação. */
export function serieDesdePrimeiroMovimento(serie: ResumoMes[]): ResumoMes[] {
  const primeiro = serie.findIndex((m) => m.receitas !== 0 || m.despesas !== 0 || m.pago !== 0);
  return primeiro >= 0 ? serie.slice(primeiro) : serie.slice(-1);
}

/** 12 meses do ano civil + total. */
export function resumoAnual(ano: number, d: DadosMes): { meses: ResumoMes[]; total: ResumoMes } {
  const meses = Array.from({ length: 12 }, (_, i) => resumirMes(`${ano}-${pad2(i + 1)}`, d));
  const receitas = somar(meses.map((m) => m.receitas));
  const despesasFixas = somar(meses.map((m) => m.despesasFixas));
  const despesasVariaveis = somar(meses.map((m) => m.despesasVariaveis));
  const despesas = somar([despesasFixas, despesasVariaveis]);
  const saldo = somar([receitas, -despesas]);
  const pago = somar(meses.map((m) => m.pago));
  return {
    meses,
    total: {
      mes: String(ano),
      receitas,
      despesasFixas,
      despesasVariaveis,
      despesas,
      saldo,
      economiaPct: receitas > 0 ? Math.round((saldo / receitas) * 1000) / 10 : null,
      pago,
      emAberto: somar([despesas, -pago]),
      qtdFixasPagas: meses.reduce((s, m) => s + m.qtdFixasPagas, 0),
      qtdFixas: meses.reduce((s, m) => s + m.qtdFixas, 0),
    },
  };
}

export interface TotalCategoria {
  categoria_id: string | null;
  total: number;
  pct: number;
}

/** Despesas (fixas não puladas + variáveis) agrupadas por categoria, maior primeiro. */
export function despesasPorCategoria(fixas: OcorrenciaFixa[], variaveis: DespesaVariavel[]): TotalCategoria[] {
  const mapa = new Map<string | null, number[]>();
  const add = (k: string | null, v: number) => { const a = mapa.get(k) ?? []; a.push(v); mapa.set(k, a); };
  for (const o of fixas) if (o.status !== "pulada") add(o.fixa.categoria_id, o.valor);
  for (const v of variaveis) add(v.categoria_id, v.valor);
  const linhas = [...mapa.entries()].map(([categoria_id, vals]) => ({ categoria_id, total: somar(vals) }));
  const geral = somar(linhas.map((l) => l.total));
  return linhas
    .filter((l) => l.total > 0)
    .map((l) => ({ ...l, pct: geral > 0 ? Math.round((l.total / geral) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------ */
/* Lançamentos recorrentes (variáveis / receitas)                      */
/* ------------------------------------------------------------------ */

/**
 * Datas das N ocorrências mensais a partir da primeira. Mantém o dia;
 * em mês curto usa o último dia (31/01 → 28/02 → 31/03).
 */
export function datasRecorrentes(primeira: string, quantidade: number): string[] {
  const y = Number(primeira.slice(0, 4));
  const m = Number(primeira.slice(5, 7));
  const d = Number(primeira.slice(8, 10));
  return Array.from({ length: quantidade }, (_, i) => {
    const alvo = y * 12 + (m - 1) + i;
    const ny = Math.floor(alvo / 12);
    const nm = alvo - ny * 12 + 1;
    return `${ny}-${pad2(nm)}-${pad2(Math.min(d, ultimoDiaDoMes(ny, nm)))}`;
  });
}

/** Remove o sufixo " (3/12)" de descrições antigas. */
export function textoBase(s: string) {
  return s.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
}

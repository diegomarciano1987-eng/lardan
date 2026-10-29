/** 0177 — Motor do financeiro da família (portado do sistema antigo). Funções puras, sem banco. */
import { describe, it, expect } from "bun:test";
import {
  datasRecorrentes, despesasPorCategoria, filtrarFixas, filtrarReceitas, filtrarVariaveis,
  gerarOcorrenciasFixas, indiceOcorrencia, resumirMes, resumoAnual, serieMensal, ultimoMesDaRegra,
  serieDesdePrimeiroMovimento, vencimentoNoMes,
} from "../../src/lib/familia/motor";
import type { DespesaFixa, DespesaVariavel, Receita, RegistroOcorrencia } from "../../src/lib/familia/tipos";

const fixa = (p: Partial<DespesaFixa>): DespesaFixa => ({
  id: "f1", nome: "Aluguel", valor: 1500, dia_vencimento: 10, mes_inicio: "2026-01-01",
  recorrencia: "mensal", parcelado: false, parcelas_total: null, categoria_id: "moradia",
  forma_pagamento: "debito", projeto_id: null, conta_id: null, encerrada_em: null, observacoes: null,
  ...p,
});
const variavel = (p: Partial<DespesaVariavel>): DespesaVariavel => ({
  id: "v1", descricao: "Mercado", valor: 100, data: "2026-10-05", recorrente: false, grupo_id: null,
  ocorrencia_numero: null, ocorrencias_total: null, categoria_id: "mercado", forma_pagamento: "debito",
  projeto_id: null, conta_id: null, data_pagamento: null, observacoes: null, ...p,
});
const receita = (p: Partial<Receita>): Receita => ({
  id: "r1", fonte: "Empresa", valor: 5000, data: "2026-10-05", recorrente: false, grupo_id: null,
  ocorrencia_numero: null, ocorrencias_total: null, categoria_id: "salario", forma_pagamento: "debito",
  observacoes: null, ...p,
});

describe("despesas fixas — quando ocorrem", () => {
  it("mensal: aparece todo mês a partir do início, nunca antes", () => {
    const f = fixa({});
    expect(indiceOcorrencia(f, "2025-12")).toBeNull();
    expect(indiceOcorrencia(f, "2026-01")).toBe(0);
    expect(indiceOcorrencia(f, "2027-01")).toBe(12);
  });

  it("anual: só no mês de aniversário", () => {
    const f = fixa({ recorrencia: "anual", mes_inicio: "2026-03-01" });
    expect(indiceOcorrencia(f, "2026-03")).toBe(0);
    expect(indiceOcorrencia(f, "2026-04")).toBeNull();
    expect(indiceOcorrencia(f, "2027-03")).toBe(1);
  });

  it("parcelada: exatamente N parcelas", () => {
    const f = fixa({ parcelado: true, parcelas_total: 3, mes_inicio: "2026-11-01" });
    const oc = gerarOcorrenciasFixas([f], [], "2026-01", "2027-12");
    expect(oc.map((o) => o.mes)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(oc.map((o) => `${o.parcela?.numero}/${o.parcela?.total}`)).toEqual(["1/3", "2/3", "3/3"]);
    expect(ultimoMesDaRegra(f)).toBe("2027-01");
  });

  it("encerrada: o mês de encerramento ainda conta, o seguinte não", () => {
    const f = fixa({ encerrada_em: "2026-05-01" });
    expect(indiceOcorrencia(f, "2026-05")).toBe(4);
    expect(indiceOcorrencia(f, "2026-06")).toBeNull();
  });

  it("vencimento no dia 31 cai no último dia em meses curtos", () => {
    expect(vencimentoNoMes("2026-02", 31)).toBe("2026-02-28");
    expect(vencimentoNoMes("2028-02", 31)).toBe("2028-02-29");
    expect(vencimentoNoMes("2026-04", 31)).toBe("2026-04-30");
    expect(vencimentoNoMes("2026-10", 31)).toBe("2026-10-31");
  });
});

describe("despesas fixas — pago, pulado e valor real", () => {
  const registros: RegistroOcorrencia[] = [
    { id: "o1", fixa_id: "f1", competencia: "2026-09-01", status: "paga", valor_pago: 1480.5, data_pagamento: "2026-09-09" },
    { id: "o2", fixa_id: "f1", competencia: "2026-08-01", status: "pulada", valor_pago: null, data_pagamento: null },
  ];
  const oc = gerarOcorrenciasFixas([fixa({})], registros, "2026-08", "2026-10");

  it("usa o valor efetivamente pago", () => {
    const set = oc.find((o) => o.mes === "2026-09")!;
    expect(set.status).toBe("pago");
    expect(set.valor).toBe(1480.5);
    expect(set.valor_previsto).toBe(1500);
  });

  it("mês pulado vale zero e não entra no total", () => {
    const ago = oc.find((o) => o.mes === "2026-08")!;
    expect(ago.status).toBe("pulada");
    const r = resumirMes("2026-08", { fixas: oc, variaveis: [], receitas: [] });
    expect(r.despesasFixas).toBe(0);
    expect(r.qtdFixas).toBe(0);
  });

  it("sem registro: a pagar pelo valor previsto", () => {
    const out = oc.find((o) => o.mes === "2026-10")!;
    expect(out.status).toBe("a_pagar");
    expect(out.valor).toBe(1500);
    expect(out.vencimento).toBe("2026-10-10");
  });
});

describe("resumo do mês", () => {
  const fixas = gerarOcorrenciasFixas(
    [fixa({}), fixa({ id: "f2", nome: "Internet", valor: 119.9, dia_vencimento: 15, categoria_id: "casa" })],
    [{ id: "o", fixa_id: "f2", competencia: "2026-10-01", status: "paga", valor_pago: 119.9, data_pagamento: "2026-10-14" }],
    "2026-10", "2026-10",
  );
  const variaveis = [
    variavel({ valor: 0.1 }), variavel({ id: "v2", valor: 0.2, data_pagamento: "2026-10-05" }),
    variavel({ id: "v3", valor: 300, data: "2026-11-01" }), // outro mês
  ];
  const receitas = [receita({}), receita({ id: "r2", valor: 1200, data: "2026-10-20" })];
  const r = resumirMes("2026-10", { fixas, variaveis, receitas });

  it("soma sem erro de ponto flutuante (0,1 + 0,2 = 0,3)", () => {
    expect(r.despesasVariaveis).toBe(0.3);
  });
  it("receitas, despesas e saldo", () => {
    expect(r.receitas).toBe(6200);
    expect(r.despesasFixas).toBe(1619.9);
    expect(r.despesas).toBe(1620.2);
    expect(r.saldo).toBe(4579.8);
    expect(r.economiaPct).toBe(73.9);
  });
  it("pago x em aberto", () => {
    expect(r.pago).toBe(120.1);
    expect(r.emAberto).toBe(1500.1);
    expect(r.qtdFixasPagas).toBe(1);
    expect(r.qtdFixas).toBe(2);
  });
  it("sem receita: economia null (não divide por zero)", () => {
    expect(resumirMes("2026-10", { fixas: [], variaveis: [], receitas: [] }).economiaPct).toBeNull();
  });
});

describe("série, ano e categorias", () => {
  const dados = {
    fixas: gerarOcorrenciasFixas([fixa({ valor: 1000 })], [], "2026-01", "2026-12"),
    variaveis: [variavel({ data: "2026-03-10", valor: 250 })],
    receitas: [receita({ data: "2026-03-01", valor: 3000 })],
  };
  it("série de 12 meses termina no mês pedido", () => {
    const s = serieMensal("2026-10", 12, dados);
    expect(s).toHaveLength(12);
    expect(s[0].mes).toBe("2025-11");
    expect(s[11].mes).toBe("2026-10");
    expect(s[0].despesas).toBe(0);
  });
  it("gráfico começa no primeiro mês com movimentação", () => {
    const s = serieDesdePrimeiroMovimento(serieMensal("2026-10", 12, dados));
    expect(s.map((m) => m.mes)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(serieDesdePrimeiroMovimento(serieMensal("2026-10", 12, { fixas: [], variaveis: [], receitas: [] })))
      .toHaveLength(1);
  });
  it("relatório anual fecha com a soma dos meses", () => {
    const a = resumoAnual(2026, dados);
    expect(a.meses).toHaveLength(12);
    expect(a.total.despesasFixas).toBe(12000);
    expect(a.total.despesasVariaveis).toBe(250);
    expect(a.total.receitas).toBe(3000);
    expect(a.total.saldo).toBe(-9250);
    expect(a.meses[2].saldo).toBe(1750);
  });
  it("por categoria ordena e calcula %", () => {
    const c = despesasPorCategoria(
      dados.fixas.filter((o) => o.mes === "2026-03"),
      dados.variaveis,
    );
    expect(c[0]).toEqual({ categoria_id: "moradia", total: 1000, pct: 80 });
    expect(c[1]).toEqual({ categoria_id: "mercado", total: 250, pct: 20 });
  });
});

describe("filtros", () => {
  it("busca ignora acento e caixa; filtros por categoria/forma", () => {
    const vs = [variavel({ descricao: "Farmácia" }), variavel({ id: "v2", descricao: "Padaria", forma_pagamento: "pix" })];
    expect(filtrarVariaveis(vs, { busca: "farmacia" }).map((v) => v.id)).toEqual(["v1"]);
    expect(filtrarVariaveis(vs, { forma_pagamento: "pix" }).map((v) => v.id)).toEqual(["v2"]);
    const oc = gerarOcorrenciasFixas([fixa({}), fixa({ id: "f2", nome: "Escola", categoria_id: "edu" })], [], "2026-10", "2026-10");
    expect(filtrarFixas(oc, { categoria_id: "edu" }).map((o) => o.fixa.nome)).toEqual(["Escola"]);
    expect(filtrarReceitas([receita({})], { projeto_id: "qualquer" })).toHaveLength(1);
  });
});

describe("datas de lançamentos recorrentes", () => {
  it("mantém o dia e ajusta meses curtos sem pular mês", () => {
    expect(datasRecorrentes("2026-01-31", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(datasRecorrentes("2026-11-05", 3)).toEqual(["2026-11-05", "2026-12-05", "2027-01-05"]);
  });
});

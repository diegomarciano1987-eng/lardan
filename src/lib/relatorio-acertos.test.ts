import { describe, expect, test } from "vitest";
import { agruparAcertos, filtrarAcertos, opcoesAlvo, type LinhaAcerto } from "./relatorio-acertos";

const base = { fonte: "lardan", remessa: 1, acerto: "2026-11-25", codigo: null, pecas: 10, valor_cents: 1000, situacao: "sem_pre_baixa", telefone: null, cidade: null } as const;
const l = (p: Partial<LinhaAcerto> & { maleta: string; consultora: string }): LinhaAcerto =>
  ({ ...base, party_id: p.maleta, praca: "Londrina", representante: "Daniel", praca_id: "p1", rep_id: "r1", direta: false, ...p }) as LinhaAcerto;

const linhas = [
  l({ maleta: "A", consultora: "Ana" }),
  l({ maleta: "B", consultora: "Bia", fonte: "smalldata", representante: "DANIEL", rep_id: "r1" }), // mesmo Daniel no SmallData
  l({ maleta: "C", consultora: "Cris", representante: "Marcos", rep_id: "r2", praca: "Maringá", praca_id: "p2" }),
  l({ maleta: "D", consultora: "Duda", representante: "Maleta direta", rep_id: null, direta: true }),
];

describe("Relatório de acertos — filtros (0356)", () => {
  test("Geral traz só as maletas diretas (sem representante)", () => {
    expect(filtrarAcertos(linhas, "geral", "").map((x) => x.maleta)).toEqual(["D"]);
  });
  test("escolher o representante Daniel traz só as maletas dele (Lardan e SmallData)", () => {
    expect(filtrarAcertos(linhas, "representante", "r1").map((x) => x.maleta)).toEqual(["A", "B"]);
  });
  test("dá para trocar para outro representante", () => {
    expect(opcoesAlvo(linhas, "representante").map((o) => o.value)).toEqual(["r1", "r2"]);
    expect(filtrarAcertos(linhas, "representante", "r2").map((x) => x.maleta)).toEqual(["C"]);
  });
  test("por praça sem escolher não inclui as diretas", () => {
    expect(filtrarAcertos(linhas, "praca", "").map((x) => x.maleta)).toEqual(["A", "B", "C"]);
  });
  test("mesmo representante com nome escrito diferente fica num grupo só", () => {
    expect(agruparAcertos(filtrarAcertos(linhas, "representante", ""), "representante").map((g) => g.itens.length)).toEqual([2, 1]);
  });
});

describe("Relatório de acertos — lista de representantes (0357)", () => {
  const cadastro = [{ value: "r1", label: "Daniel de Freitas Maciel" }, { value: "r9", label: "Guilherme Augusto" }];
  test("todos os representantes do cadastro aparecem, mesmo sem acerto no período (0 maletas)", () => {
    const o = opcoesAlvo(linhas, "representante", cadastro);
    expect(o.find((x) => x.value === "r9")?.hint).toBe("0 maletas");
    expect(o.find((x) => x.value === "r1")).toMatchObject({ label: "Daniel de Freitas Maciel", hint: "2 maletas" });
  });
  test("por praça a lista do cadastro de representantes não entra", () => {
    expect(opcoesAlvo(linhas, "praca", cadastro).map((x) => x.value)).toEqual(["p1", "p2"]);
  });
});

describe("Relatório de acertos — Geral pega toda maleta sem representante (0357)", () => {
  const solta = l({ maleta: "E", consultora: "Eva", representante: "Sem representante", rep_id: null, praca: "Sem praça", praca_id: null });
  test("maleta Lardan sem representante (fora de remessa) vai para Geral e sai da lista de representantes", () => {
    const todas = [...linhas, solta];
    expect(filtrarAcertos(todas, "geral", "").map((x) => x.maleta)).toEqual(["D", "E"]);
    expect(opcoesAlvo(todas, "representante").map((o) => o.label)).not.toContain("Sem representante");
  });
});

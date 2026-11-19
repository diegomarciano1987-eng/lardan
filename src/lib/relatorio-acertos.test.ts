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

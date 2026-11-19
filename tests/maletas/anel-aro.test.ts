/** 0338 — regras de aro do Daniel: grade 4 a 30, aro com 1 ou 2 dígitos, ajustável sem aro. */
import { describe, expect, test } from "vitest";
import { GRADE_PADRAO, arosDaGrade, ehAnelAjustavel, ehNomeDeAnel, normalizarAro, previaGrade } from "@/lib/anel-aro";

describe("aro do anel", () => {
  test("grade padrão vai do aro 4 ao 30 (27 tamanhos)", () => {
    const g = arosDaGrade(GRADE_PADRAO.de, GRADE_PADRAO.ate);
    expect(g).toHaveLength(27);
    expect(g[0]).toBe("04");
    expect(g.at(-1)).toBe("30");
  });

  test("aro com 1 dígito vira 2 dígitos; zero e 3 dígitos não são aro", () => {
    expect(normalizarAro("4")).toBe("04");
    expect(normalizarAro(9)).toBe("09");
    expect(normalizarAro("30")).toBe("30");
    expect(normalizarAro("0")).toBeNull();
    expect(normalizarAro("100")).toBeNull();
    expect(normalizarAro("")).toBeNull();
  });

  test("prévia da grade separa o que falta do que já existe (LAN0353: 20 e 24 já existem)", () => {
    const p = previaGrade(4, 30, ["20", "24", null]);
    expect(p.existentes).toEqual(["20", "24"]);
    expect(p.criar).toHaveLength(25);
    expect(p.criar).not.toContain("20");
  });

  test("grade invertida ou fora de 1 a 60 não gera nada", () => {
    expect(arosDaGrade(30, 4)).toEqual([]);
    expect(arosDaGrade(0, 10)).toEqual([]);
    expect(arosDaGrade(4, 61)).toEqual([]);
  });

  test("anel pelo nome (AN/ANEL) e ajustável/aberto sem aro", () => {
    expect(ehNomeDeAnel("AN DOU SOLITARIO GOTA 8MM")).toBe(true);
    expect(ehNomeDeAnel("ANEL CORAÇÃO")).toBe(true);
    expect(ehNomeDeAnel("ARGOLA PR")).toBe(false);
    expect(ehAnelAjustavel("AN DOU AJUSTAVEL 2 CORAÇÕES")).toBe(true);
    expect(ehAnelAjustavel("ANEL ABERTO CORAÇAO E CRUZ")).toBe(true);
    expect(ehAnelAjustavel("AN DOU SOLITARIO GOTA 8MM")).toBe(false);
  });
});

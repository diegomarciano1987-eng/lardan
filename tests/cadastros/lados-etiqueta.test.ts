import { describe, expect, it } from "vitest";
import { escolherLados, ladosAtual, voltarUmLado, ouvirLados } from "@/lib/lados-etiqueta";

describe("1 lado / 2 lados da etiqueta de peça (0341)", () => {
  it("1 lado é o padrão ao abrir a tela", () => {
    expect(ladosAtual()).toBe(false);
  });
  it("2 lados só quando a pessoa escolhe, e volta para 1 lado depois da impressão", () => {
    escolherLados(true);
    expect(ladosAtual()).toBe(true);
    voltarUmLado();
    expect(ladosAtual()).toBe(false);
  });
  it("a escolha não fica guardada no computador", () => {
    escolherLados(true);
    expect(JSON.stringify({ ...localStorageSeguro() })).not.toContain("duplicar");
    voltarUmLado();
  });
  it("avisa todos os seletores da tela quando muda", () => {
    let n = 0;
    const parar = ouvirLados(() => { n++; });
    escolherLados(true); voltarUmLado(); voltarUmLado();
    parar();
    expect(n).toBe(2);
  });
});

function localStorageSeguro(): Record<string, string> {
  try { return Object.fromEntries(Object.entries(globalThis.localStorage ?? {})); } catch { return {}; }
}

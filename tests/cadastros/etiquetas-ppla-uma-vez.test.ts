import { describe, expect, it } from "vitest";
import { comandosTeste } from "../../src/lib/etiquetas-raw";
import { CONFIG_ETIQUETA } from "../../src/lib/etiquetas";

describe("PPLA imprime referência e preço uma única vez", () => {
  it("barras Code 128 sem texto legível (e minúsculo) e uma só linha de referência", () => {
    const linhas = comandosTeste(CONFIG_ETIQUETA, "ppla", 1).split("\r\n");
    const barras = linhas.filter((l) => /^1[eE]\d/.test(l));
    expect(barras).toHaveLength(1);
    expect(barras[0]!.startsWith("1e")).toBe(true);
    expect(linhas.filter((l) => l.startsWith("1211") && l.endsWith("LBRP0295-005499"))).toHaveLength(1);
  });
});

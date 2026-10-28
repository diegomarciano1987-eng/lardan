import { describe, expect, it } from "vitest";
import { comandosTeste, comandosEtiquetas } from "../../src/lib/etiquetas-raw";
import { CONFIG_ETIQUETA } from "../../src/lib/etiquetas";

describe("comandos Argox etiqueta de joia", () => {
  it("PPLB usa largura 100 mm e altura 12 mm (800 × 96 pontos), nunca 100 × 55", () => {
    const c = comandosTeste(CONFIG_ETIQUETA, "pplb", 3);
    expect(c).toContain("q800"); expect(c).toContain("Q96,24"); expect(c).not.toContain("Q440");
    expect(c).toContain('"LBRP0295-005499"'); expect(c).toContain("P3");
  });
  it("barras de 6,6 mm = 53 pontos", () => {
    expect(comandosTeste(CONFIG_ETIQUETA, "pplb", 1)).toMatch(/^B\d+,\d+,0,1,1,1,53,N,"LBRP0295-005499"$/m);
  });
  it("PPLZ com mesmas medidas", () => {
    const c = comandosTeste(CONFIG_ETIQUETA, "pplz", 2);
    expect(c).toContain("^PW800"); expect(c).toContain("^LL96"); expect(c).toContain("^PQ2");
  });
  it("quantidade vira cópias e peça sem código é bloqueada", () => {
    expect(() => comandosEtiquetas([{ id: "x", nome: "A", barcode: null, referencia: null, quantidade: 1 }], CONFIG_ETIQUETA, "pplb")).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { comandosEtiquetaMaleta } from "@/lib/etiqueta-maleta-raw";
describe("etiqueta da maleta 48x28", () => {
  it("PPLB usa 384 x 224 pontos", () => { const c = comandosEtiquetaMaleta("MAL00323", "pplb"); expect(c).toContain("q384"); expect(c).toContain("Q224,16"); });
  it("PPLZ usa 384 x 224 pontos", () => { const c = comandosEtiquetaMaleta("MAL00323", "pplz"); expect(c).toContain("^PW384"); expect(c).toContain("^LL224"); });
});

import { abreviarNome as abrev0188, comandosEtiquetaMaleta as cmd0188 } from "@/lib/etiqueta-maleta-raw";
describe("etiqueta maleta ajustes 30/10", () => {
  it("abrevia o representante", () => {
    expect(abrev0188("Daniel de Freitas Maciel")).toBe("DANIEL F. MACIEL");
    expect(abrev0188("Guilherme Augusto Pelegrini da Silva")).toBe("GUILHERME A. P. SILVA");
  });
  it("nome maior e números 30% menores no PPLZ", () => {
    const z = cmd0188("MAL-00323", "pplz", 1, { cliente_codigo: "7479", cliente_nome: "Ana Paula Ribeiro", representante: "Daniel de Freitas Maciel", remessa_numero: 924, maleta_numero: 4 });
    expect(z).toContain("^A0N,27,23^FD7479 - ANA PAULA RIBEIRO");
    expect(z).toContain("^A0N,31,25^FD924");
    expect(z).toContain("DANIEL F. MACIEL");
  });
});

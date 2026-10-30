import { describe, it, expect } from "vitest";
import { comandosEtiquetaMaleta } from "@/lib/etiqueta-maleta-raw";
describe("etiqueta da maleta 48x28", () => {
  it("PPLB usa 384 x 224 pontos", () => { const c = comandosEtiquetaMaleta("MAL00323", "pplb"); expect(c).toContain("q384"); expect(c).toContain("Q224,16"); });
  it("PPLZ usa 384 x 224 pontos", () => { const c = comandosEtiquetaMaleta("MAL00323", "pplz"); expect(c).toContain("^PW384"); expect(c).toContain("^LL224"); });
});

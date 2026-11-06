import { describe, expect, it } from "vitest";
import { comandosEtiquetaMaleta, linhasEtiquetaMaleta } from "@/lib/etiqueta-maleta-raw";

describe("etiqueta da maleta de abertura", () => {
  it("sem consultora sai ABERTURA n da remessa x", () => {
    const L = linhasEtiquetaMaleta({ abertura_numero: 3, remessa_numero: 926, representante: "Daniel de Freitas Maciel", cliente_nome: null });
    expect(L.l1).toBe("ABERTURA 3 REM 926");
    expect(L.l2).toBe("SEM CONSULTORA");
    expect(L.l3).toBe("DANIEL F. MACIEL");
    expect(comandosEtiquetaMaleta("18497", "pplz", 1, { abertura_numero: 3, remessa_numero: 926 })).toContain("ABERTURA 3 REM 926");
  });
  it("com consultora continua código - nome", () => {
    const L = linhasEtiquetaMaleta({ cliente_codigo: "9121", cliente_nome: "Ana Caroline", cidade: "Ibaiti / PR", remessa_numero: 927 });
    expect(L.l1).toBe("9121 - ANA CAROLINE");
    expect(L.l2).toBe("IBAITI / PR");
  });
});

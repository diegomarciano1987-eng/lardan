import { describe, expect, it } from "vitest";
import { estadoAceite, progressoMaleta } from "../../src/lib/consultora-progresso";

describe("Topo financeiro e aceite obrigatório", () => {
  it("barra começa em zero e termina no total monetário da remessa", () => {
    expect(progressoMaleta(0, 350000)).toEqual({ total: 350000, vendido: 0, percentual: 0 });
    expect(progressoMaleta(175000, 350000).percentual).toBe(50);
    expect(progressoMaleta(350000, 350000).percentual).toBe(100);
    expect(progressoMaleta(400000, 350000).percentual).toBe(100);
    expect(progressoMaleta(0, 0).percentual).toBe(0);
  });
  it("não libera o aplicativo antes de verificar o aceite", () => {
    expect(estadoAceite(undefined)).toBe("verificando");
    expect(estadoAceite([{ cycle_id: "pendente" }])).toBe("pendente");
  });
  it("resultado vazio já verificado mantém navegação livre durante atualização", () => {
    expect(estadoAceite([])).toBe("liberada");
  });
});
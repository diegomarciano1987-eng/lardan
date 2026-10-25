import { describe, expect, it } from "vitest";
import { mostrarPilotoGlass } from "../../src/lib/consultora-glass";

describe("piloto visual Diego Silva", () => {
  it("inclui somente o início da conta autorizada", () => {
    expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", "inicio")).toBe(true);
  });
  it("não inclui outras contas ou sessão ausente", () => {
    expect(mostrarPilotoGlass("outra-conta", "inicio")).toBe(false);
    expect(mostrarPilotoGlass(undefined, "inicio")).toBe(false);
  });
  it("preserva todas as outras abas", () => {
    for (const aba of ["clientes", "pedidos", "maleta", "vitrine", "historico", "indicacoes", "biblioteca", "mais", "novo"]) {
      expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", aba)).toBe(false);
    }
  });
});
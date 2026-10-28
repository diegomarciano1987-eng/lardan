import { describe, expect, it } from "vitest";
import { mostrarPilotoGlass } from "../../src/lib/consultora-glass";

describe("piloto visual Diego Silva", () => {
  it("inclui o início da conta autorizada", () => {
    expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", "inicio")).toBe(true);
  });
  it("não inclui outras contas ou sessão ausente", () => {
    expect(mostrarPilotoGlass("outra-conta", "inicio")).toBe(false);
    expect(mostrarPilotoGlass(undefined, "inicio")).toBe(false);
  });
  it("inclui todas as telas da consultora autorizada na etapa 2", () => {
    for (const aba of ["clientes", "pedidos", "maleta", "vitrine", "historico", "indicacoes", "biblioteca", "mais", "novo", "jornada", "liga", "financeiro"]) {
      expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", aba)).toBe(true);
      expect(mostrarPilotoGlass("outra-conta", aba)).toBe(false);
    }
  });
  it("não aplica o piloto em módulos fora da consultora", () => {
    expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", "admin")).toBe(false);
    expect(mostrarPilotoGlass("27b777de-76bf-43ce-b566-af2df4ac8439", "")).toBe(false);
  });
});
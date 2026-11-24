import { describe, expect, it } from "vitest";
import { casaBusca, normalizar } from "@/lib/busca-maletas";

// Regra (Diego, 24/11/2026): toda busca ignora acento e maiúsculas e aceita as palavras em qualquer ordem.
describe("busca sem acento e sem diferença de maiúsculas", () => {
  it("'maria de fatima' acha 'Maria de Fátima'", () => {
    expect(casaBusca("maria de fatima", ["Maria de Fátima Souza"])).toBe(true);
  });
  it("tudo maiúsculo acha nome com acento", () => {
    expect(casaBusca("MARIA FÁTIMA", ["maria de fatima"])).toBe(true);
  });
  it("palavras fora de ordem", () => {
    expect(casaBusca("fatima maria", ["Maria de Fátima"])).toBe(true);
  });
  it("nome diferente não casa", () => {
    expect(casaBusca("fatima", ["Ana Paula"])).toBe(false);
  });
  it("normalizar remove acento e baixa a caixa", () => {
    expect(normalizar("JOÃO CONCEIÇÃO")).toBe("joao conceicao");
  });
});

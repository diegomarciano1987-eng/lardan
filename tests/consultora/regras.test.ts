import { describe, expect, it } from "vitest";
import { fimGarantia, idadePedido, precoFinal90, tomIdade } from "../../src/lib/consultora-regras";

describe("Regras aprovadas do app da consultora", () => {
  it("novas precificações sobem para ,90 sem baixar o preço", () => {
    expect(precoFinal90(7989)).toBe(7990);
    expect(precoFinal90(9776)).toBe(9790);
    expect(precoFinal90(7991)).toBe(8090);
    expect(precoFinal90(7990)).toBe(7990);
    expect(precoFinal90(0)).toBe(0);
  });
  it("idade até 3 dias verde, 4–7 amarelo, 8+ vermelho", () => {
    expect(tomIdade(3)).toBe("success"); expect(tomIdade(4)).toBe("warning"); expect(tomIdade(7)).toBe("warning"); expect(tomIdade(8)).toBe("destructive");
    expect(idadePedido("2026-10-09T03:00:00Z", new Date("2026-10-16T23:00:00Z"))).toBe(7);
  });
  it("garantia de dois anos e aniversário de compra em ano bissexto", () => {
    expect(fimGarantia("2026-10-16")).toBe("2028-10-16"); expect(fimGarantia("2024-02-29")).toBe("2026-02-28");
  });
});
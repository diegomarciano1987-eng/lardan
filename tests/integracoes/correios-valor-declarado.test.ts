import { describe, expect, test } from "bun:test";
import { faixaDoErro, valorDeclaradoAceito } from "@/lib/correios/valor-declarado";

describe("valor declarado do PAC dentro da faixa dos Correios", () => {
  test("R$ 18,00 (abaixo do mínimo) vira R$ 25,63", () => expect(valorDeclaradoAceito(1800)).toBe(2563));
  test("valor dentro da faixa não muda", () => expect(valorDeclaradoAceito(15000)).toBe(15000));
  test("acima do máximo vira R$ 4.668,29", () => expect(valorDeclaradoAceito(900000)).toBe(466829));
  test("sem custo continua sem valor declarado", () => expect(valorDeclaradoAceito(0)).toBe(0));
  test("lê a faixa da recusa dos Correios", () => {
    expect(faixaDoErro("Recusado pelos Correios (400): O valor declarado deve ser entre 25,63 e 4668,29. Servico Adicional = 064."))
      .toEqual({ minCents: 2563, maxCents: 466829 });
    expect(faixaDoErro("Outro erro")).toBeNull();
  });
});

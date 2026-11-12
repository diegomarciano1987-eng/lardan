import { describe, expect, it } from "vitest";
import { centavosDigitados, limparDinheiro } from "./dinheiro-digitado";

describe("dinheiro digitado no acordo (0300)", () => {
  it("formato brasileiro com milhar e vírgula", () => expect(centavosDigitados("1.129,82")).toBe(112982));
  it("vírgula sem milhar", () => expect(centavosDigitados("172,16")).toBe(17216));
  it("ponto como decimal não vira valor 100 vezes maior", () => expect(centavosDigitados("172.16")).toBe(17216));
  it("ponto de milhar sem centavos", () => expect(centavosDigitados("1.129")).toBe(112900));
  it("letras e R$ são ignorados", () => {
    expect(limparDinheiro("R$ 17,92a")).toBe("17,92");
    expect(centavosDigitados("R$ 17,92")).toBe(1792);
  });
  it("vazio é zero", () => expect(centavosDigitados("")).toBe(0));
});

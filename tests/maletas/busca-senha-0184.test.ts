import { describe, expect, it } from "vitest";
import { filtrarComposicao } from "@/lib/busca-composicao";
import { gerarSenhaForte, traduzirErroSenha } from "@/lib/senha-forte";

const lista: [string, { nome: string; sku: string | null }][] = [
  ["v1", { nome: "Brinco Argola Dourada", sku: "BR-10" }],
  ["v2", { nome: "CJ DOU ORGANICO PEROLA", sku: null }],
  ["v3", { nome: "Pulseira Riviera", sku: "PU-7" }],
];
const codigos = { v2: "7891234567890 LCJ0043", v3: "PU-7 LPU0007" };

describe("busca na composição da montagem", () => {
  it("acha pelo bip (código de barras)", () => {
    expect(filtrarComposicao(lista, "7891234567890", codigos).map(([id]) => id)).toEqual(["v2"]);
  });
  it("acha pela referência sem diferenciar maiúsculas", () => {
    expect(filtrarComposicao(lista, "lcj0043", codigos).map(([id]) => id)).toEqual(["v2"]);
  });
  it("acha por partes do nome, sem acento", () => {
    expect(filtrarComposicao(lista, "argola dour", codigos).map(([id]) => id)).toEqual(["v1"]);
  });
  it("busca vazia mostra todas", () => {
    expect(filtrarComposicao(lista, "  ", codigos)).toHaveLength(3);
  });
});

describe("senha forte da colaboradora", () => {
  it("gera Palavra+Palavra+4 dígitos, pelo menos 12 caracteres", () => {
    for (let i = 0; i < 50; i++) {
      const s = gerarSenhaForte();
      expect(s).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/);
      expect(s.length).toBeGreaterThanOrEqual(12);
    }
  });
  it("traduz o recado de senha fraca", () => {
    expect(traduzirErroSenha("Password is known to be weak and easy to guess, please choose a different one")).toMatch(/Gerar senha forte/);
  });
});

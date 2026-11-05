import { describe, expect, it } from "vitest";
import { expandirPorVariante, somarEstoque } from "./produtos-lista";

const v = (id: string, product_id: string, extra: Partial<{ is_active: boolean; price_cents: number | null }> = {}) => ({
  id, product_id, label: id, barcode: `B${id}`, reference_code: `R${id}`, price_cents: null, is_active: true, ...extra,
});

describe("lista de produtos por variante", () => {
  it("produto com 3 variantes vira 3 linhas, cada uma com seu código", () => {
    const linhas = expandirPorVariante([{ id: "trio", price_cents: 5490 }], [v("a", "trio"), v("b", "trio"), v("c", "trio")]);
    expect(linhas.map((l) => l.barcode)).toEqual(["Ba", "Bb", "Bc"]);
    expect(linhas.every((l) => l.totalVariantes === 3)).toBe(true);
  });
  it("produto sem variante ativa continua aparecendo", () => {
    const linhas = expandirPorVariante([{ id: "p", price_cents: 100 }], [v("x", "p", { is_active: false })]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].variantId).toBeNull();
  });
  it("preço da variante prevalece; sem preço herda do produto", () => {
    const linhas = expandirPorVariante([{ id: "p", price_cents: 4990 }], [v("a", "p", { price_cents: 5490 }), v("b", "p")]);
    expect(linhas.map((l) => l.precoLinha)).toEqual([5490, 4990]);
  });
  it("estoque soma depósito e loja menos reservas, maletas à parte", () => {
    const m = somarEstoque([
      { variant_id: "a", quantity: 5, reserved: 1, locations: { kind: "deposito" } },
      { variant_id: "a", quantity: 2, reserved: 0, locations: { kind: "loja" } },
      { variant_id: "a", quantity: 3, reserved: 0, locations: { kind: "maleta" } },
    ]);
    expect(m.get("a")).toEqual({ quantidade: 7, reservado: 1, disponivel: 6, maletas: 3 });
  });
});

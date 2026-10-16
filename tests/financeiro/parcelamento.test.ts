import { describe, expect, it } from "vitest";
import { dividirEmParcelas } from "@/components/admin/financeiro/NovoTituloDialog";

describe("parcelar em Nx", () => {
  it("R$ 100,00 em 3x: 33,33 + 33,33 + 33,34 (centavos na última)", () => {
    const p = dividirEmParcelas(10000, 3, new Date(2026, 9, 10));
    expect(p.map((x) => x.valor)).toEqual(["33,33", "33,33", "33,34"]);
  });

  it("vencimentos mês a mês, respeitando fim de mês (31/01 → 28/02)", () => {
    const p = dividirEmParcelas(30000, 3, new Date(2027, 0, 31));
    expect(p.map((x) => x.vencimento?.toDateString())).toEqual([
      new Date(2027, 0, 31).toDateString(),
      new Date(2027, 1, 28).toDateString(),
      new Date(2027, 2, 31).toDateString(),
    ]);
  });
});

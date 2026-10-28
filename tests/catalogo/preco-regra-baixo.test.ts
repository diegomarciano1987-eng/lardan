import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";

// Regra Daniel 28/10/2026: sempre para baixo, degraus de R$ 5,00 terminados em 4,90/9,90.
const regra = (c: number): number =>
  Number(execSync(`psql -At -c "select public.preco_regra_lardan(${c})"`).toString().trim());
const temBanco = !!process.env.PGHOST;

describe.skipIf(!temBanco)("preco_regra_lardan para baixo", () => {
  it("80,00 a 84,99 vira 79,90", () => { expect(regra(8000)).toBe(7990); expect(regra(8499)).toBe(7990); });
  it("85,00 a 89,99 vira 84,90", () => { expect(regra(8500)).toBe(8490); expect(regra(8999)).toBe(8490); });
  it("90,00 a 94,99 vira 89,90", () => { expect(regra(9000)).toBe(8990); expect(regra(9499)).toBe(8990); });
  it("preço que já é degrau não muda", () => { expect(regra(7990)).toBe(7990); expect(regra(8490)).toBe(8490); });
  it("abaixo de R$ 5,00 não muda", () => { expect(regra(499)).toBe(499); });
  it("nenhum produto do catálogo fica mais caro", () => {
    const n = Number(execSync(`psql -At -c "select count(*) from product_variants where price_cents>0 and public.preco_regra_lardan(price_cents) > price_cents"`).toString().trim());
    expect(n).toBe(0);
  });
});

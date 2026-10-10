import { test, expect } from "vitest";
import { calcularEncargos, montarPlano } from "../../src/lib/cobranca-acordo";
test("encargos e plano", () => {
  const l = calcularEncargos([{ installment_id: "a", vencimento: "2026-09-10", saldo_cents: 100000 }], "2026-10-10", { multa_pct: 2, juros_mes_pct: 1, carencia_dias: 0 });
  expect(l[0]).toMatchObject({ dias: 30, multa: 2000, juros: 1000, total: 103000 });
  expect(calcularEncargos([{ installment_id: "a", vencimento: "2026-09-10", saldo_cents: 100000 }], "2026-10-10", { multa_pct: 2, juros_mes_pct: 1, carencia_dias: 0 }, false)[0]!.total).toBe(100000);
  const p = montarPlano(100000, 10000, 3, "2026-01-31");
  expect(p.map((x) => x.valor_cents)).toEqual([30000, 30000, 30000]);
  expect(p.map((x) => x.data)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  expect(montarPlano(1000, 0, 3, "2026-01-01").reduce((a, x) => a + x.valor_cents, 0)).toBe(1000);
});

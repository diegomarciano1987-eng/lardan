import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { comissaoMaleta, comissaoPorRemessa, faixaPara } from "@/lib/comissao-maletas";

const faixas = [
  { min_cents: 20000, percentual: 35, titulo: "Prata" },
  { min_cents: 0, percentual: 30, titulo: "Base" },
];

describe("comissão por maleta", () => {
  it("abaixo de R$ 200 fica na faixa a partir de R$ 0", () => {
    expect(faixaPara(19999, faixas)?.titulo).toBe("Base");
  });
  it("a partir de R$ 200 respeita a próxima faixa", () => {
    expect(faixaPara(20000, faixas)?.titulo).toBe("Prata");
    expect(comissaoMaleta(100000, faixas)?.comissao_cents).toBe(35000);
  });
  it("maleta sem acerto não tem comissão calculada", () => {
    expect(comissaoMaleta(null, faixas)).toBeNull();
  });
});

describe("comissão agrupada por remessa (regra inviolável)", () => {
  const fx = [{ min_cents: 0, percentual: 30, titulo: "Base" }, { min_cents: 200000, percentual: 35, titulo: "Prata" }];
  it("3 kits da remessa 872 somam R$ 2.205,06 e a faixa vale sobre o total", () => {
    const kits = [113084, 69366, 38056].map((v, i) => ({ remessa: 872, kit: i + 1, fechamento: "2026-10-21", valor_vendido_cents: v }));
    const [g] = comissaoPorRemessa(kits, fx);
    expect(g.vendido_cents).toBe(220506);
    expect(g.faixa?.titulo).toBe("Prata");
    expect(g.comissao_cents).toBe(77177);
  });
  it("remessas diferentes não se misturam", () => {
    const r = comissaoPorRemessa([
      { remessa: 911, kit: 1, fechamento: "2026-10-01", valor_vendido_cents: 150000 },
      { remessa: 872, kit: 1, fechamento: "2026-10-01", valor_vendido_cents: 150000 },
    ], fx);
    expect(r.map((g) => g.faixa?.titulo)).toEqual(["Base", "Base"]);
  });
  it("remessa sem nenhum kit acertado fica sem comissão", () => {
    const [g] = comissaoPorRemessa([{ remessa: 921, kit: 1, fechamento: null, valor_vendido_cents: null }], fx);
    expect(g.comissao_cents).toBeNull();
  });
});

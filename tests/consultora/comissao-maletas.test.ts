import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { comissaoMaleta, faixaPara } from "@/lib/comissao-maletas";

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

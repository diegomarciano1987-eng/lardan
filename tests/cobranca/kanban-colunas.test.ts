import { describe, it, expect } from "vitest";
import { colunaDoDevedor } from "@/lib/cobranca-kanban";
describe("colunas do Kanban de cobrança", () => {
  it("judicial sempre vence", () => expect(colunaDoDevedor({ etapa: "acompanhamento" }, { dias_atraso: 9 })).toBe("judicial"));
  it("acordo com parcela vencida vai para atrasado", () => expect(colunaDoDevedor({ etapa: "em_negociacao" }, { dias_atraso: 1 })).toBe("atrasado"));
  it("acordo em dia fica em andamento", () => expect(colunaDoDevedor({ etapa: "em_contato" }, { dias_atraso: 0 })).toBe("acordo"));
  it("novo atraso sem acordo fica na régua Asaas", () => expect(colunaDoDevedor({ etapa: "novo_atraso" })).toBe("regua"));
  it("promessa antiga cai em negociação", () => expect(colunaDoDevedor({ etapa: "promessa" })).toBe("negociacao"));
});

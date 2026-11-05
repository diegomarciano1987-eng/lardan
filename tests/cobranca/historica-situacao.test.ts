import { describe, expect, test } from "vitest";
import { situacaoHistorica, soHistorica, type DevedorHistorico } from "@/lib/cobranca-historica";

const base: DevedorHistorico = {
  party_id: "p", nome: "X", codigo: "1", parcelas: 2, saldo_cents: 100, venc_min: "2024-01-01", venc_max: "2025-01-01",
  installment_ids: [], tem_recente: false, judicial: false, asaas_abertas: 0, acordo_id: null, acordo_origem: null,
};

describe("situação na cobrança histórica", () => {
  test("sem bloqueio = pronta", () => expect(situacaoHistorica(base).tipo).toBe("apta"));
  test("Judicial vence tudo", () => expect(situacaoHistorica({ ...base, judicial: true, asaas_abertas: 2 }).tipo).toBe("judicial"));
  test("fatura única existente", () => expect(situacaoHistorica({ ...base, acordo_id: "s", acordo_origem: "historica" }).tipo).toBe("faturada"));
  test("acordo comum ativo", () => expect(situacaoHistorica({ ...base, acordo_id: "s", acordo_origem: "acordo" }).tipo).toBe("acordo"));
  test("cobrança aberta no Asaas bloqueia", () => expect(situacaoHistorica({ ...base, asaas_abertas: 1 }).tipo).toBe("asaas"));
  test("só sai da Régua quem não deve nada depois de 2025", () => {
    expect(soHistorica({ tem_recente: false })).toBe(true);
    expect(soHistorica({ tem_recente: true })).toBe(false);
  });
});

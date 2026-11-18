/** 18/11/2026 (Diego): acordo com dívida até 31/12/2025 sempre leva termo de confissão para assinar. */
import { describe, expect, test } from "vitest";
import { acordoPedeTermo, rotuloTermo } from "@/lib/cobranca-historica";

const parcelas = [
  { installment_id: "antiga", vencimento: "2025-12-31" },
  { installment_id: "nova", vencimento: "2026-01-01" },
];

describe("termo de confissão nos acordos históricos", () => {
  test("fatura única da Histórica pede termo", () => {
    expect(acordoPedeTermo({ origem: "historica", installment_ids: [] }, parcelas)).toBe(true);
  });
  test("acordo com parcela vencida até 31/12/2025 pede termo", () => {
    expect(acordoPedeTermo({ origem: null, installment_ids: ["antiga", "nova"] }, parcelas)).toBe(true);
  });
  test("acordo só com dívida de 2026 não é obrigado", () => {
    expect(acordoPedeTermo({ origem: "acordo", installment_ids: ["nova"] }, parcelas)).toBe(false);
  });
  test("situação do termo: assinado, aguardando e sem termo", () => {
    const base = { sign_url: null, criado_em: "2026-11-18", assinado_em: null, enviado_whatsapp: true };
    expect(rotuloTermo({ ...base, status: "assinado" }).tipo).toBe("assinado");
    expect(rotuloTermo({ ...base, status: "pendente" }).tipo).toBe("pendente");
    expect(rotuloTermo({ ...base, status: "cancelado" }).tipo).toBe("sem");
    expect(rotuloTermo(null).tipo).toBe("sem");
  });
});

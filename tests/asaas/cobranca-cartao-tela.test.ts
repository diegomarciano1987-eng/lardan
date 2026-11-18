import { describe, expect, it } from "vitest";
import { validarPedidoCobranca } from "../../src/lib/asaas/pedido-cobranca";
import { simularParcelas } from "../../src/lib/cartao-parcelas";

const id = "00000000-0000-0000-0000-000000000001";

describe("cobrança da ficha do título — cartão 1x a 12x (Diego 18/11)", () => {
  it("aceita cartão e repassa o número de parcelas escolhido", () => {
    expect(validarPedidoCobranca({ installmentId: id, billingType: "CREDIT_CARD", parcelasCartao: 12 })).toEqual({ installmentId: id, billingType: "CREDIT_CARD", parcelasCartao: 12 });
  });
  it("cartão sem parcelas informadas vira à vista (1x)", () => {
    expect(validarPedidoCobranca({ installmentId: id, billingType: "CREDIT_CARD" }).parcelasCartao).toBe(1);
  });
  it("recusa 0x, 13x e número quebrado", () => {
    expect(() => validarPedidoCobranca({ installmentId: id, billingType: "CREDIT_CARD", parcelasCartao: 13 })).toThrow("de 1 a 12");
    expect(() => validarPedidoCobranca({ installmentId: id, billingType: "CREDIT_CARD", parcelasCartao: 0 })).toThrow("de 1 a 12");
    expect(() => validarPedidoCobranca({ installmentId: id, billingType: "CREDIT_CARD", parcelasCartao: 2.5 })).toThrow("de 1 a 12");
  });
  it("Pix, boleto e link seguem iguais e nunca levam parcelas", () => {
    expect(validarPedidoCobranca({ installmentId: id, billingType: "BOLETO", parcelasCartao: 6 })).toEqual({ installmentId: id, billingType: "BOLETO" });
  });
  it("1x a 3x sem juros; 4x a 12x a cliente paga a taxa (3,49% até 6x, 3,99% de 7 a 12x + R$ 0,49)", () => {
    expect(simularParcelas(201074, 3).totalCents).toBe(201074);
    // 4x: teto((2010,74 + 0,49) / 0,9651) = 2083,97
    expect(simularParcelas(201074, 4).totalCents).toBe(208397);
    // 12x: teto((2010,74 + 0,49) / 0,9601) = 2094,82
    expect(simularParcelas(201074, 12).totalCents).toBe(209482);
  });
});

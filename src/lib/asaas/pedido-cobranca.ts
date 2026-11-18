/**
 * Validação do pedido de cobrança vindo das telas administrativas (ficha do título,
 * "Cobrar no Asaas"). Cartão: 1x a 12x — 1–3x sem juros, 4–12x a cliente paga a
 * taxa (o valor somado é calculado pelo banco em asaas_cartao_acrescimo).
 */
export type FormaCobrancaTela = "PIX" | "BOLETO" | "UNDEFINED" | "CREDIT_CARD";
export type PedidoCobrancaTela = { installmentId: string; billingType: FormaCobrancaTela; parcelasCartao?: number | null };

export function validarPedidoCobranca(d: PedidoCobrancaTela): PedidoCobrancaTela {
  if (!d?.installmentId) throw new Error("Parcela obrigatória.");
  if (!["PIX", "BOLETO", "UNDEFINED", "CREDIT_CARD"].includes(d.billingType)) throw new Error("Forma de pagamento inválida.");
  if (d.billingType !== "CREDIT_CARD") return { installmentId: d.installmentId, billingType: d.billingType };
  const n = Number(d.parcelasCartao ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error("Parcelas do cartão: de 1 a 12.");
  return { installmentId: d.installmentId, billingType: d.billingType, parcelasCartao: n };
}

/**
 * Cartão parcelado pelo Asaas (regra do Diego, 13/11/2026 — 0329).
 * 1x a 3x: sem juros (a Lardan absorve a taxa).
 * 4x a 12x: a cliente paga a taxa do Asaas da conta Lardan (3,49% de 2 a 6x; 3,99% de 7 a 12x; + R$ 0,49),
 * somada de forma que a Lardan receba o valor da venda.
 * O valor que vai no link é calculado pelo banco (asaas_cartao_acrescimo); esta função é a MESMA conta,
 * só para mostrar à consultora antes de gerar o link.
 */
export const PARCELAS_SEM_JUROS = 3;
export const PARCELAS_MAX = 12;

export function acrescimoCartaoCents(baseCents: number, parcelas: number): number {
  if (!(baseCents > 0) || parcelas <= PARCELAS_SEM_JUROS) return 0;
  const pct = parcelas <= 6 ? 0.0349 : 0.0399;
  return Math.ceil((baseCents + 49) / (1 - pct) - 1e-9) - baseCents;
}

export function simularParcelas(baseCents: number, parcelas: number) {
  const total = baseCents + acrescimoCartaoCents(baseCents, parcelas);
  return { parcelas, totalCents: total, parcelaCents: Math.floor(total / parcelas), semJuros: parcelas <= PARCELAS_SEM_JUROS };
}

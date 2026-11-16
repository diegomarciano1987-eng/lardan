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
  // conta inteira (sem arredondamento de vírgula): total = teto((base + 49) / (1 − taxa))
  const n = (Math.round(baseCents) + 49) * 10000;
  const d = parcelas <= 6 ? 10000 - 349 : 10000 - 399;
  const total = Math.floor(n / d) + (n % d === 0 ? 0 : 1);
  return total - Math.round(baseCents);
}

export function simularParcelas(baseCents: number, parcelas: number) {
  const total = baseCents + acrescimoCartaoCents(baseCents, parcelas);
  return { parcelas, totalCents: total, parcelaCents: Math.floor(total / parcelas), semJuros: parcelas <= PARCELAS_SEM_JUROS };
}

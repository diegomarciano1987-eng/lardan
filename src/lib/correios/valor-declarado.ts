/**
 * Valor declarado do PAC (serviço adicional 064). Os Correios só aceitam uma faixa: em 11/11/2026
 * recusaram R$ 18,00 com "deve ser entre 25,63 e 4668,29". Abaixo do mínimo declara o mínimo,
 * acima do máximo declara o máximo; zero continua sem valor declarado.
 */
export interface FaixaValorDeclarado { minCents: number; maxCents: number }
export const FAIXA_VALOR_DECLARADO_PAC: FaixaValorDeclarado = { minCents: 2563, maxCents: 466829 };

export function valorDeclaradoAceito(cents: number, faixa: FaixaValorDeclarado = FAIXA_VALOR_DECLARADO_PAC): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.min(Math.max(Math.round(cents), faixa.minCents), faixa.maxCents);
}

const reais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100);
/** Lê a faixa na mensagem de recusa dos Correios ("O valor declarado deve ser entre 25,63 e 4668,29"). */
export function faixaDoErro(msg: string | null | undefined): FaixaValorDeclarado | null {
  const m = /valor declarado deve ser entre\s*([\d.]+,\d{2})\s*e\s*([\d.]+,\d{2})/i.exec(msg ?? "");
  if (!m) return null;
  const f = { minCents: reais(m[1]!), maxCents: reais(m[2]!) };
  return f.minCents > 0 && f.maxCents >= f.minCents ? f : null;
}

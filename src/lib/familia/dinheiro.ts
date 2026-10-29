/* ============================================================
 * FINANCEIRO DA FAMÍLIA — dinheiro em reais e exportação CSV
 * ============================================================ */
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatBRL = (v: number | null | undefined) => BRL.format(Number(v ?? 0));

export function formatBRLInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return NUM.format(n);
}

/** Digitação "caixa registradora": só dígitos, os 2 últimos são centavos ("150000" → 1.500,00). */
export function mascararCentavos(digitado: string): { texto: string; valor: number } {
  const digitos = digitado.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
  if (!digitos) return { texto: "", valor: 0 };
  const valor = Number(digitos) / 100;
  return { texto: formatBRLInput(valor), valor };
}

/** Valor com vírgula para planilha brasileira. */
export const reaisCSV = (v: number) => v.toFixed(2).replace(".", ",");

/** Baixa um CSV (separador ;, com BOM para o Excel abrir com acento). Só roda no navegador. */
export function baixarCSV<T>(nome: string, linhas: T[], colunas: { titulo: string; valor: (l: T) => string }[]) {
  const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const corpo = [colunas.map((c) => esc(c.titulo)).join(";"), ...linhas.map((l) => colunas.map((c) => esc(c.valor(l))).join(";"))].join("\r\n");
  const blob = new Blob(["﻿" + corpo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

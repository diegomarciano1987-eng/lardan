/**
 * 0300 (Diego, 12/11/2026): campo de dinheiro digitado à mão (acordo judicial, etc.).
 * Aceita "1.129,82", "1129,82", "1129.82", "172,16", "R$ 17,92". Nunca multiplica por 100 um ponto decimal.
 */
export function limparDinheiro(v: string): string {
  return v.replace(/[^\d.,]/g, "").slice(0, 16);
}
export function centavosDigitados(s: string): number {
  const t = limparDinheiro(s ?? "");
  if (!t) return 0;
  let normal: string;
  if (t.includes(",")) {
    const i = t.lastIndexOf(",");
    normal = t.slice(0, i).replace(/[.,]/g, "") + "." + t.slice(i + 1).replace(/[.,]/g, "");
  } else {
    const partes = t.split(".");
    // um único ponto com 1 ou 2 casas no fim = decimal (172.16); senão os pontos são de milhar (1.129 / 1.234.567)
    normal = partes.length === 2 && partes[1]!.length <= 2 ? `${partes[0]}.${partes[1]}` : partes.join("");
  }
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

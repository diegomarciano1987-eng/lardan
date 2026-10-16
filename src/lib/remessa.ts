/**
 * Classificação da peça por tipo (brinco, anel, colar, pulseira, tornozeleira)
 * a partir do SKU/código e, em fallback, do nome do produto.
 * Usada na montagem da remessa: metas por tipo e cards da conferência.
 */

export type TipoPeca = "brinco" | "anel" | "colar" | "pulseira" | "tornozeleira" | "outro";

export const TIPO_PECA_LABEL: Record<TipoPeca, string> = {
  brinco: "Brincos",
  anel: "Anéis",
  colar: "Colares",
  pulseira: "Pulseiras",
  tornozeleira: "Tornozeleiras",
  outro: "Outros",
};

const PREFIXOS: [RegExp, TipoPeca][] = [
  [/^(L?TN|TORN)/, "tornozeleira"],
  [/^(L?PU|L?PC|PUL)/, "pulseira"],
  [/^(L?AN)/, "anel"],
  [/^(L?GR|COL|CH0)/, "colar"],
  [/^(L?BR|L?BI|AQ|BTR|TAQ|CH2)/, "brinco"],
];

export function tipoPeca(sku: string | null | undefined, nome: string | null | undefined): TipoPeca {
  const cod = (sku ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  for (const [re, tipo] of PREFIXOS) if (re.test(cod)) return tipo;
  const n = (nome ?? "").toUpperCase();
  if (/TORNOZELEIRA/.test(n)) return "tornozeleira";
  if (/PULSEIRA/.test(n)) return "pulseira";
  if (/ANEL|AN\.|AN DOU|AN PR/.test(n)) return "anel";
  if (/COLAR|GARGANTILHA|CHOKER|GR /.test(n)) return "colar";
  if (/BRINCO|BR /.test(n)) return "brinco";
  return "outro";
}

/** Parâmetros de montagem configuráveis (tabela remessa_parametros). */
export interface ParametrosRemessa {
  pecas_cliente_nova: number;
  meta_colares: number;
  meta_pulseiras: number;
  meta_aneis: number;
  meta_tornozeleiras: number;
}

export const PARAMETROS_PADRAO: ParametrosRemessa = {
  pecas_cliente_nova: 35,
  meta_colares: 3,
  meta_pulseiras: 3,
  meta_aneis: 4,
  meta_tornozeleiras: 0,
};

/** Metas por tipo: brincos recebem o restante do total da maleta. */
export function metasPorTipo(p: ParametrosRemessa): Record<TipoPeca, number> {
  const fixos = p.meta_colares + p.meta_pulseiras + p.meta_aneis + p.meta_tornozeleiras;
  return {
    colar: p.meta_colares,
    pulseira: p.meta_pulseiras,
    anel: p.meta_aneis,
    tornozeleira: p.meta_tornozeleiras,
    brinco: Math.max(p.pecas_cliente_nova - fixos, 0),
    outro: 0,
  };
}

/* ---------------- valor por extenso (promissória) ---------------- */

const UNIDADES = ["", "Um", "Dois", "Três", "Quatro", "Cinco", "Seis", "Sete", "Oito", "Nove"];
const DEZ_A_DEZENOVE = [
  "Dez", "Onze", "Doze", "Treze", "Quatorze", "Quinze",
  "Dezesseis", "Dezessete", "Dezoito", "Dezenove",
];
const DEZENAS = ["", "", "Vinte", "Trinta", "Quarenta", "Cinquenta", "Sessenta", "Setenta", "Oitenta", "Noventa"];
const CENTENAS = ["", "Cento", "Duzentos", "Trezentos", "Quatrocentos", "Quinhentos", "Seiscentos", "Setecentos", "Oitocentos", "Novecentos"];

function tresDigitos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "Cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]!);
  if (resto >= 20) {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]!);
  } else if (resto >= 10) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]!);
  } else if (resto > 0) {
    partes.push(UNIDADES[resto]!);
  }
  return partes.join(" e ");
}

/** Valor em centavos por extenso, no formato da promissória: "Seis Mil, Sessenta Reais e Quarenta e Seis Centavos". */
export function valorPorExtenso(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const partes: string[] = [];
  if (reais === 0 && centavos === 0) return "Zero Reais";
  if (reais > 0) {
    const milhar = Math.floor(reais / 1000);
    const resto = reais % 1000;
    const pedacos: string[] = [];
    if (milhar > 0) pedacos.push(milhar === 1 ? "Mil" : `${tresDigitos(milhar)} Mil`);
    if (resto > 0) pedacos.push(tresDigitos(resto));
    partes.push(`${pedacos.join(", ")} ${reais === 1 ? "Real" : "Reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${tresDigitos(centavos)} ${centavos === 1 ? "Centavo" : "Centavos"}`);
  }
  return partes.join(" e ");
}

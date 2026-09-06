/**
 * Base geográfica da Inteligência da Rede.
 * Sem dado de negócio: apenas códigos oficiais e matemática de projeção.
 */

/** Código numérico do IBGE → sigla da UF (malhas oficiais usam `codarea`). */
export const CODIGO_IBGE_UF: Record<string, string> = {
  "11": "RO",
  "12": "AC",
  "13": "AM",
  "14": "RR",
  "15": "PA",
  "16": "AP",
  "17": "TO",
  "21": "MA",
  "22": "PI",
  "23": "CE",
  "24": "RN",
  "25": "PB",
  "26": "PE",
  "27": "AL",
  "28": "SE",
  "29": "BA",
  "31": "MG",
  "32": "ES",
  "33": "RJ",
  "35": "SP",
  "41": "PR",
  "42": "SC",
  "43": "RS",
  "50": "MS",
  "51": "MT",
  "52": "GO",
  "53": "DF",
};

export const UF_CODIGO_IBGE: Record<string, string> = Object.fromEntries(
  Object.entries(CODIGO_IBGE_UF).map(([codigo, uf]) => [uf, codigo]),
);

export interface Geometria {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface Feicao {
  type: "Feature";
  properties: { codarea: string };
  geometry: Geometria;
}

export interface Malha {
  type: "FeatureCollection";
  features: Feicao[];
}

export interface Projecao {
  largura: number;
  altura: number;
  ponto: (lon: number, lat: number) => [number, number];
}

interface Caixa {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function percorrer(g: Geometria, visita: (lon: number, lat: number) => void) {
  const aneis =
    g.type === "Polygon"
      ? (g.coordinates as number[][][])
      : (g.coordinates as number[][][][]).flat();
  for (const anel of aneis) for (const [lon, lat] of anel) visita(lon!, lat!);
}

export function caixaDaMalha(malha: Malha): Caixa {
  const c: Caixa = { minLon: 180, maxLon: -180, minLat: 90, maxLat: -90 };
  for (const f of malha.features)
    percorrer(f.geometry, (lon, lat) => {
      if (lon < c.minLon) c.minLon = lon;
      if (lon > c.maxLon) c.maxLon = lon;
      if (lat < c.minLat) c.minLat = lat;
      if (lat > c.maxLat) c.maxLat = lat;
    });
  return c;
}

/** Equirretangular com correção de latitude — leve, previsível e suficiente para o Brasil. */
export function projetar(malha: Malha, largura: number, margem = 8): Projecao {
  const c = caixaDaMalha(malha);
  const latMedia = ((c.minLat + c.maxLat) / 2) * (Math.PI / 180);
  const fator = Math.cos(latMedia) || 1;
  const larguraGeo = (c.maxLon - c.minLon) * fator;
  const alturaGeo = c.maxLat - c.minLat;
  const util = largura - margem * 2;
  const escala = util / larguraGeo;
  const altura = alturaGeo * escala + margem * 2;
  return {
    largura,
    altura,
    ponto: (lon, lat) => [
      margem + (lon - c.minLon) * fator * escala,
      margem + (c.maxLat - lat) * escala,
    ],
  };
}

export function caminho(g: Geometria, p: Projecao): string {
  const aneis =
    g.type === "Polygon"
      ? (g.coordinates as number[][][])
      : (g.coordinates as number[][][][]).flat();
  let d = "";
  for (const anel of aneis) {
    anel.forEach(([lon, lat], i) => {
      const [x, y] = p.ponto(lon!, lat!);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    d += "Z";
  }
  return d;
}

/** Centro visual aproximado de uma feição (média dos vértices). */
export function centro(g: Geometria, p: Projecao): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  percorrer(g, (lon, lat) => {
    const [x, y] = p.ponto(lon, lat);
    sx += x;
    sy += y;
    n += 1;
  });
  return n ? [sx / n, sy / n] : [0, 0];
}

/** Escala de intensidade adaptada à distribuição: quantis, não faixa linear. */
export function escalaQuantil(valores: number[], faixas = 5): number[] {
  const positivos = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (positivos.length === 0) return [];
  const cortes: number[] = [];
  for (let i = 1; i < faixas; i += 1) {
    const idx = Math.floor((positivos.length * i) / faixas);
    cortes.push(positivos[Math.min(idx, positivos.length - 1)]!);
  }
  return Array.from(new Set(cortes));
}

export function faixaDe(valor: number, cortes: number[]): number {
  if (valor <= 0) return 0;
  let faixa = 1;
  for (const corte of cortes) if (valor > corte) faixa += 1;
  return Math.min(faixa, cortes.length + 1);
}

/** Rosa queimado da marca em intensidades — sem gradiente e sem cor fantasiosa. */
export const INTENSIDADES = [
  "color-mix(in oklab, var(--rose) 10%, white)",
  "color-mix(in oklab, var(--rose) 26%, white)",
  "color-mix(in oklab, var(--rose) 44%, white)",
  "color-mix(in oklab, var(--rose) 64%, white)",
  "color-mix(in oklab, var(--rose) 84%, white)",
];

export function corDaFaixa(faixa: number): string {
  if (faixa <= 0) return "color-mix(in oklab, var(--muted) 45%, white)";
  return INTENSIDADES[Math.min(faixa, INTENSIDADES.length) - 1]!;
}

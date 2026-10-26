/**
 * Regras puras da localização por rua (sem rede, testáveis).
 * Só rua + cidade + UF saem para o provedor: nunca nome, número ou documento.
 */

export const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const ABREVIACOES: [RegExp, string][] = [
  [/^(r|rua)\.?\s+/i, "Rua "],
  [/^(av|avda|aven)\.?\s+/i, "Avenida "],
  [/^(al)\.?\s+/i, "Alameda "],
  [/^(tv|trav)\.?\s+/i, "Travessa "],
  [/^(est|estr)\.?\s+/i, "Estrada "],
  [/^(rod)\.?\s+/i, "Rodovia "],
  [/^(p[cç]a?|pra[cç]a)\.?\s+/i, "Praça "],
];

/** "R. LUIS LERCO, 399 - casa" → "Rua Luis Lerco". Devolve null quando não há rua utilizável. */
export function normalizarRua(rua: string | null | undefined): string | null {
  let r = (rua ?? "").split(/[,;]| - | n[ºo°]\s*\d/i)[0]!.replace(/\s+/g, " ").trim();
  r = r.replace(/\s+\d+[a-z]?$/i, "").trim();
  if (r.replace(/[^a-zà-ú]/gi, "").length < 3) return null;
  for (const [re, troca] of ABREVIACOES) {
    if (re.test(r)) {
      r = r.replace(re, troca);
      break;
    }
  }
  return r
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase())
    .replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());
}

export const chaveRua = (rua: string, cidade: string, uf: string) =>
  `rua:${semAcento(rua)}|${semAcento(cidade)}|${uf.toUpperCase()}`;

export interface ResultadoNominatim {
  lat: string;
  lon: string;
  place_rank?: number;
  address?: Record<string, string | undefined>;
}

/** Aceita só resultado de rua (rank ≥ 26) dentro da cidade esperada. */
export function resultadoNaCidade(r: ResultadoNominatim, cidade: string): { lat: number; lng: number } | null {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if ((r.place_rank ?? 0) < 26) return null;
  const alvo = semAcento(cidade);
  const a = r.address ?? {};
  const nomes = [a.city, a.town, a.village, a.municipality, a.city_district, a.county].filter(Boolean).map((x) => semAcento(x!));
  return nomes.includes(alvo) ? { lat, lng } : null;
}

/** Distância aproximada em metros (suficiente para dizer "é o centro da cidade"). */
export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Pontos que caem no mesmo lugar são abertos em leque (espiral) para nenhuma ficar escondida.
 * Desloca em graus, ~18 m por volta.
 */
export function espalhar<T extends { lat: number; lng: number }>(lista: T[]): (T & { latV: number; lngV: number })[] {
  const grupos = new Map<string, T[]>();
  for (const p of lista) {
    const k = `${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(p);
  }
  const saida: (T & { latV: number; lngV: number })[] = [];
  for (const ps of grupos.values()) {
    ps.forEach((p, i) => {
      if (i === 0) return saida.push({ ...p, latV: p.lat, lngV: p.lng });
      const ang = i * 2.399963; // ângulo áureo
      const raio = 0.00016 * Math.sqrt(i);
      saida.push({ ...p, latV: p.lat + raio * Math.sin(ang), lngV: p.lng + (raio * Math.cos(ang)) / Math.cos((p.lat * Math.PI) / 180) });
    });
  }
  return saida;
}

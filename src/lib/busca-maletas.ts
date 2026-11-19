/**
 * 0340 — busca de maleta em qualquer tela: número (MAL-00467 ou 467), etiqueta (código de barras),
 * nome da consultora (por partes, sem acento) ou o código dela. Escopo e permissão ficam no banco
 * (maletas_buscar → kit_cycle_in_scope).
 */
import { supabase } from "@/integrations/supabase/client";

export interface MaletaEncontrada {
  cycle_id: string;
  maleta: string;
  ciclo: number | null;
  status: string;
  consultora_party_id: string | null;
  consultora: string | null;
  consultora_codigo: string | null;
  remessa_id: string | null;
  remessa: number | null;
  praca: string | null;
  representante: string | null;
  data_acerto: string | null;
  abertura_numero: number | null;
  pecas: number | null;
}

export async function buscarMaletas(termo: string, limite = 20): Promise<MaletaEncontrada[]> {
  if (termo.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("maletas_buscar" as never, { _termo: termo, _limite: limite } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MaletaEncontrada[];
}

/** "[Cód. 7510] Isabela…" — a equipe identifica a consultora pelo código. */
export function comCodigo(nome: string | null | undefined, codigo: string | null | undefined): string {
  const n = (nome ?? "").trim();
  if (!codigo) return n;
  return n ? `[Cód. ${codigo}] ${n}` : `[Cód. ${codigo}]`;
}

/** Texto parece a etiqueta/número da maleta (bipado), e não um nome? */
export function pareceCodigoMaleta(t: string): boolean {
  const s = t.trim();
  return /^MAL-?\s*\d+$/i.test(s) || /^[a-f0-9]{24}$/i.test(s);
}

/** Filtro local (sem acento, por partes) para listas já carregadas na tela. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
export function casaBusca(termo: string, campos: (string | number | null | undefined)[]): boolean {
  const t = normalizar(termo.trim());
  if (!t) return true;
  const alvo = normalizar(campos.filter((c) => c !== null && c !== undefined && c !== "").join(" "));
  const digitos = t.replace(/\D/g, "");
  // "467" acha MAL-00467
  if (/^(mal-?\s*)?\d+$/.test(t) && digitos) {
    const nums = alvo.match(/\d+/g) ?? [];
    if (nums.some((n) => Number(n) === Number(digitos) || n.startsWith(digitos))) return true;
  }
  return t.split(/\s+/).filter(Boolean).every((p) => alvo.includes(p));
}

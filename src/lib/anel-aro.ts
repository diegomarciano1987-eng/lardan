/**
 * 0338 — anéis do aro 4 ao 30 (Daniel, 19/11/2026). Regras puras + chamadas ao banco.
 * O banco é quem decide (barcode_resolver / anel_aro_variante / anel_grade_gerar);
 * aqui só ficam a grade padrão, o texto do aro e o reconhecimento visual de anel.
 */
import { supabase } from "@/integrations/supabase/client";

/** Grade que o Daniel usa: do aro 4 ao 30. */
export const GRADE_PADRAO = { de: 4, ate: 30 } as const;
/** Limites aceitos pelo banco para a grade. */
export const GRADE_LIMITE = { min: 1, max: 60 } as const;

/** "4" → "04"; aceita 1 a 99. Fora disso: null (o banco recusa com mensagem clara). */
export function normalizarAro(valor: string | number | null | undefined): string | null {
  const t = String(valor ?? "").trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 99 ? String(n).padStart(2, "0") : null;
}

/** Lista de aros de/até, já no formato de 2 dígitos. */
export function arosDaGrade(de: number, ate: number): string[] {
  if (!Number.isInteger(de) || !Number.isInteger(ate) || de > ate || de < GRADE_LIMITE.min || ate > GRADE_LIMITE.max) return [];
  return Array.from({ length: ate - de + 1 }, (_, i) => String(de + i).padStart(2, "0"));
}

/** O que a grade vai criar e o que já existe (prévia antes de confirmar). */
export function previaGrade(de: number, ate: number, existentes: (string | null | undefined)[]) {
  const ja = new Set(existentes.map((e) => normalizarAro(e)).filter((e): e is string => !!e));
  const todos = arosDaGrade(de, ate);
  return { criar: todos.filter((a) => !ja.has(a)), existentes: todos.filter((a) => ja.has(a)) };
}

/** Mesma regra do banco (categoria_por_nome): nome começando por "AN" ou "ANEL". */
export function ehNomeDeAnel(nome: string | null | undefined) {
  return /^(AN|ANEL)\s/i.test(String(nome ?? "").trim());
}

/** Anel ajustável/aberto não tem aro (mesma regra do banco: anel_ajustavel). */
export function ehAnelAjustavel(nome: string | null | undefined) {
  return /AJUST|ABERTO/i.test(String(nome ?? ""));
}

export type RespostaAro = {
  encontrado: boolean;
  variant_id?: string;
  product_id?: string;
  produto?: string;
  variante?: string;
  tamanho?: string | null;
  barcode?: string | null;
  variante_criada?: boolean;
  codigo_proprio?: boolean;
  preco_cents?: number | null;
};

/** Aro escolhido na tela: acha ou registra a variação daquele aro (nunca repete código). */
export async function aroDaPeca(productId: string, tamanho: string) {
  const { data, error } = await supabase.rpc("anel_aro_variante", { _product: productId, _tamanho: tamanho });
  if (error) throw error;
  return data as unknown as RespostaAro;
}

export type ResultadoGrade = {
  produto: string;
  criadas: string[];
  existentes: string[];
  codigo_proprio: { tamanho: string; barcode: string }[];
  total_criadas: number;
  total_existentes: number;
};

export async function gerarGradeAros(productId: string, de: number, ate: number) {
  const { data, error } = await supabase.rpc("anel_grade_gerar", { _product: productId, _de: de, _ate: ate });
  if (error) throw error;
  return data as unknown as ResultadoGrade;
}

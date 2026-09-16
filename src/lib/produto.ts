import { supabase } from "@/integrations/supabase/client";

/**
 * Camada única do cadastro de produto. Toda gravação passa pelas operações
 * canônicas do banco (product_save, variant_save, variant_cost_set), que
 * conferem permissão, unicidade de SKU/código de barras e auditam.
 */

export interface ProdutoBase {
  id: string;
  name: string;
  slug: string;
  internal_code: string | null;
  legacy_code: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  collection_id: string | null;
  raw_material: string | null;
  raw_weight_grams: number | null;
  raw_supplier_id: string | null;
  raw_piece_cost_cents: number | null;
  measurements: string | null;
  short_description: string | null;
  description: string | null;
  care_instructions: string | null;
  warranty_text: string | null;
  seo_title: string | null;
  seo_description: string | null;
  price_cents: number | null;
  price_is_public: boolean;
  is_featured: boolean;
  status: string;
  is_legacy: boolean;
  requires_catalog_review: boolean;
  updated_at: string;
}

export interface Impedimento {
  codigo: string;
  grupo: string;
  rotulo: string;
}

export const GRUPOS_CHECKLIST = [
  "Identificação",
  "Classificação",
  "Material bruto",
  "Variantes",
  "Conteúdo",
  "Imagens",
  "SEO",
  "Custos",
  "Outros",
];

/** Salva rascunho ou edição. Devolve o id para seguir na mesma ficha. */
export async function salvarProduto(
  id: string | null,
  payload: Record<string, unknown>,
): Promise<{ id: string; internal_code: string | null; slug: string; status: string }> {
  const { data, error } = await supabase.rpc("product_save", {
    _id: id as unknown as string,
    _payload: payload as never,
  });
  if (error) throw error;
  return data as never;
}

export async function salvarVariante(
  id: string | null,
  payload: Record<string, unknown>,
): Promise<{ id: string; sku: string | null; label: string; barcode: string | null }> {
  const { data, error } = await supabase.rpc("variant_save", {
    _id: id as unknown as string,
    _payload: payload as never,
  });
  if (error) throw error;
  return data as never;
}

export async function registrarCusto(variantId: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("variant_cost_set", {
    _variant_id: variantId,
    _payload: payload as never,
  });
  if (error) throw error;
  return data as { id: string; final: number; componentes: number; diferenca: number };
}

export async function checklistPublicacao(id: string): Promise<Impedimento[]> {
  const { data, error } = await supabase.rpc("product_publish_checklist", { _id: id });
  if (error) throw error;
  return (data as unknown as Impedimento[]) ?? [];
}

export async function consultarCodigoBarras(codigo: string) {
  const { data, error } = await supabase.rpc("barcode_lookup", { _code: codigo.trim() });
  if (error) throw error;
  return data as unknown as {
    encontrado: boolean;
    product_id?: string;
    produto?: string;
    variant_id?: string;
    variante?: string;
    sku?: string;
  };
}

export async function listarTiposDeBanho() {
  const { data, error } = await supabase
    .from("plating_types")
    .select("id, name, sku_token, is_active")
    .eq("is_active", true)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

/**
 * Resumo objetivo a partir da descrição já digitada. Não inventa material,
 * banho, garantia ou benefício: apenas recorta as primeiras frases.
 */
export function gerarResumo(descricao: string, maximo = 220): string {
  const limpo = descricao.replace(/\s+/g, " ").trim();
  if (!limpo) return "";
  if (limpo.length <= maximo) return limpo;
  const frases = limpo.split(/(?<=[.!?])\s+/);
  let saida = "";
  for (const f of frases) {
    if ((saida + " " + f).trim().length > maximo) break;
    saida = (saida + " " + f).trim();
    if (saida.length >= 140) break;
  }
  if (!saida) saida = limpo.slice(0, maximo);
  return saida.length > maximo ? saida.slice(0, maximo - 1).trimEnd() + "…" : saida;
}

/** Percentual de conclusão pelo novo modelo: campos preenchidos / campos exigidos. */
export function completude(p: Partial<ProdutoBase>, temImagem: boolean, temVariante: boolean) {
  const checks = [
    !!p.name?.trim(),
    !!p.slug?.trim(),
    !!p.internal_code,
    !!p.category_id,
    !!p.raw_material?.trim(),
    !!(p.raw_weight_grams && p.raw_weight_grams > 0),
    !!p.raw_supplier_id,
    !!(p.raw_piece_cost_cents && p.raw_piece_cost_cents > 0),
    !!p.measurements?.trim(),
    !!p.short_description?.trim(),
    !!p.description?.trim(),
    !!p.care_instructions?.trim(),
    !!p.warranty_text?.trim(),
    !!p.seo_title?.trim(),
    !!p.seo_description?.trim(),
    temImagem,
    temVariante,
  ];
  const ok = checks.filter(Boolean).length;
  return Math.round((ok / checks.length) * 100);
}

/** Prévia do nome da variante: produto + banho + tamanho. */
export function nomeVariante(produto: string, banho: string | null, tamanho: string | null) {
  return [produto, banho || null, tamanho ? `Aro ${tamanho}`.replace(/^Aro (?=\D)/, "") : null]
    .filter(Boolean)
    .join(" — ");
}

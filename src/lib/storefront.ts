import { supabase } from "@/integrations/supabase/client";

/** Endereço público e permanente de uma imagem de produto publicado. */
export function mediaUrl(mediaId: string | null | undefined) {
  return mediaId ? `/api/public/midia/${mediaId}` : null;
}

export interface CategoriaPublica {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ordem: number;
  produtos: number;
}

export interface ProdutoVitrine {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  category_slug: string | null;
  category_name: string | null;
  collection_slug: string | null;
  price_cents: number | null;
  is_featured: boolean;
  cover_media_id: string | null;
  cover_alt: string | null;
  total: number;
}

export interface ProdutoPublico {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  description: string | null;
  material: string | null;
  plating: string | null;
  measurements: string | null;
  weight_grams: number | null;
  care_instructions: string | null;
  warranty_text: string | null;
  seo_title: string | null;
  seo_description: string | null;
  is_featured: boolean;
  price_cents: number | null;
  category: { slug: string; name: string } | null;
  collection: { slug: string; name: string } | null;
  imagens: { media_id: string; alt: string; position: number }[];
  variantes: { id: string; label: string; size: string | null; color: string | null; price_cents: number | null }[];
}

export async function listPublicCategories(): Promise<CategoriaPublica[]> {
  const { data, error } = await supabase.rpc("public_categories");
  if (error) throw error;
  return (data ?? []) as CategoriaPublica[];
}

export async function listPublicProducts(params: {
  categoria?: string | null;
  colecao?: string | null;
  busca?: string | null;
  destaque?: boolean | null;
  pagina?: number;
  porPagina?: number;
}): Promise<{ rows: ProdutoVitrine[]; total: number }> {
  const porPagina = params.porPagina ?? 24;
  const pagina = params.pagina ?? 0;
  const args: Record<string, unknown> = { _limit: porPagina, _offset: pagina * porPagina };
  if (params.categoria) args["_category_slug"] = params.categoria;
  if (params.colecao) args["_collection_slug"] = params.colecao;
  if (params.busca) args["_search"] = params.busca;
  if (params.destaque != null) args["_featured"] = params.destaque;
  const { data, error } = await supabase.rpc("public_catalog_list", args as never);
  if (error) throw error;
  const rows = (data ?? []) as ProdutoVitrine[];
  return { rows, total: rows[0]?.total ? Number(rows[0].total) : 0 };
}

export async function getPublicProduct(slug: string): Promise<ProdutoPublico | null> {
  const { data, error } = await supabase.rpc("public_product", { _slug: slug });
  if (error) throw error;
  return (data as unknown as ProdutoPublico | null) ?? null;
}

export function formatPreco(cents: number | null | undefined) {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ---------- Páginas públicas de categoria ---------- */

export interface CategoriaDetalhe {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  hero_media_id: string | null;
  hero_alt: string | null;
  fallback_media_id: string | null;
  total: number;
  destaques: number;
  tem_preco_publico: boolean;
  preco_min: number | null;
  preco_max: number | null;
  colecoes: { slug: string; name: string }[];
  materiais: string[];
  banhos: string[];
}

export interface PecaVitrine {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  category_slug: string | null;
  category_name: string | null;
  collection_slug: string | null;
  collection_name: string | null;
  material: string | null;
  plating: string | null;
  price_cents: number | null;
  is_featured: boolean;
  is_new_arrival: boolean;
  em_estoque: boolean;
  cover_media_id: string | null;
  cover_alt: string | null;
  hover_media_id: string | null;
  total: number;
}

export type OrdemVitrine = "curadoria" | "lancamentos" | "nome" | "preco_asc" | "preco_desc";

export interface BrowseParams {
  categoria?: string | null;
  colecao?: string | null;
  busca?: string | null;
  material?: string | null;
  banho?: string | null;
  destaque?: boolean | null;
  lancamento?: boolean | null;
  disponivel?: boolean | null;
  precoMin?: number | null;
  precoMax?: number | null;
  ordem?: OrdemVitrine;
  pagina?: number;
  porPagina?: number;
}

export async function getPublicCategory(slug: string): Promise<CategoriaDetalhe | null> {
  const { data, error } = await supabase.rpc("public_category", { _slug: slug });
  if (error) throw error;
  return (data as unknown as CategoriaDetalhe | null) ?? null;
}

/** Busca, filtros, ordenação e paginação resolvidos no servidor. */
export async function browsePublicProducts(
  params: BrowseParams,
): Promise<{ rows: PecaVitrine[]; total: number }> {
  const porPagina = params.porPagina ?? 12;
  const pagina = params.pagina ?? 0;
  const args: Record<string, unknown> = {
    _limit: porPagina,
    _offset: pagina * porPagina,
    _sort: params.ordem ?? "curadoria",
  };
  if (params.categoria) args["_category_slug"] = params.categoria;
  if (params.colecao) args["_collection_slug"] = params.colecao;
  if (params.busca) args["_search"] = params.busca;
  if (params.material) args["_material"] = params.material;
  if (params.banho) args["_plating"] = params.banho;
  if (params.destaque != null) args["_featured"] = params.destaque;
  if (params.lancamento != null) args["_new_arrival"] = params.lancamento;
  if (params.disponivel != null) args["_in_stock"] = params.disponivel;
  if (params.precoMin != null) args["_price_min"] = params.precoMin;
  if (params.precoMax != null) args["_price_max"] = params.precoMax;
  const { data, error } = await supabase.rpc("public_catalog_browse", args as never);
  if (error) throw error;
  const rows = (data ?? []) as PecaVitrine[];
  return { rows, total: rows[0]?.total ? Number(rows[0].total) : 0 };
}

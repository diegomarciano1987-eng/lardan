import { supabase } from "@/integrations/supabase/client";

/** Tabelas de cadastro-base atendidas pela camada genérica. */
export type CadastroTable =
  | "suppliers"
  | "business_entities"
  | "locations"
  | "categories"
  | "collections"
  | "products"
  | "product_variants";

export interface PagedResult<T> {
  rows: T[];
  total: number;
}

export interface ListParams {
  table: CadastroTable;
  select: string;
  /** Colunas usadas na busca inteligente do servidor. */
  searchColumns: string[];
  search: string;
  page: number;
  pageSize: number;
  orderBy?: string;
  ascending?: boolean;
  filters?: Record<string, string | boolean | null | undefined>;
}

function escapeOr(value: string) {
  // vírgula e parênteses quebram a sintaxe do filtro `or` do PostgREST
  return value.replace(/[,()]/g, " ").trim();
}

/**
 * Busca paginada no servidor. A busca é por partes: cada palavra digitada
 * precisa aparecer em alguma das colunas indicadas.
 */
export async function listPaged<T>(params: ListParams): Promise<PagedResult<T>> {
  const {
    table,
    select,
    searchColumns,
    search,
    page,
    pageSize,
    orderBy = "created_at",
    ascending = false,
    filters = {},
  } = params;

  let query = supabase
    .from(table)
    .select(select, { count: "exact" })
    .order(orderBy, { ascending })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  for (const [column, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "todos") continue;
    query = query.eq(column, value as never);
  }

  const termos = escapeOr(search)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 4);

  for (const termo of termos) {
    query = query.or(searchColumns.map((c) => `${c}.ilike.%${termo}%`).join(","));
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as T[], total: count ?? 0 };
}

/** Cria ou atualiza um registro simples e devolve a linha gravada. */
export async function saveRecord<T>(
  table: CadastroTable,
  values: Record<string, unknown>,
  id?: string,
): Promise<T> {
  const payload = { ...values };
  if (id) {
    const { data, error } = await supabase
      .from(table)
      .update(payload as never)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data as T;
  }
  const { data, error } = await supabase
    .from(table)
    .insert(payload as never)
    .select()
    .single();
  if (error) throw error;
  return data as T;
}

/** Sobe uma imagem para o balde privado e registra na biblioteca de mídias. */
export async function uploadMedia(file: File, alt: string) {
  const { data: userData } = await supabase.auth.getUser();
  const extensao = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const caminho = `catalogo/${crypto.randomUUID()}.${extensao}`;

  const { error: upErr } = await supabase.storage
    .from("media")
    .upload(caminho, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      storage_path: caminho,
      url: caminho,
      alt,
      byte_size: file.size,
      content_type: file.type,
      created_by: userData.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Link temporário de leitura para uma imagem guardada no balde privado. */
export async function signedMediaUrl(path: string, seconds = 3600) {
  const { data, error } = await supabase.storage.from("media").createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Situações escolhíveis no cadastro-base. Publicar/retirar do ar só pela Central da Vitrine. */
export const STATUS_OPTIONS_EDICAO = [
  { value: "rascunho", label: "Rascunho" },
  { value: "revisao", label: "Em revisão" },
  { value: "arquivado", label: "Arquivado" },
];

/**
 * Traduz recusas do banco para uma frase que diz o que falta, onde resolver e por quê.
 * Nunca devolve código, SQL ou termo interno.
 */
export function mensagemDeErro(erro: unknown): string {
  const e = erro as { code?: string; message?: string } | null;
  const bruto = (e?.message ?? "").toString();
  const codigo = e?.code ?? "";
  if (bruto.includes("publish_taxonomy")) {
    return "Publicar uma categoria ou coleção é feito em Site › Categorias e coleções, no botão Publicar no site — é lá que o sistema confere descrição, título público e texto para buscadores antes de deixar a página visível.";
  }
  if (bruto.includes("unpublish_taxonomy")) {
    return "Para tirar do ar, use Site › Categorias e coleções e informe o motivo: o sistema precisa saber o que fazer com os produtos que dependem dela.";
  }
  if (bruto.includes("publish_products")) {
    return "Publicar uma peça é feito em Site › Produtos da vitrine, pelo botão Publicar, que confere foto, preço e descrição antes de liberar no site.";
  }
  if (codigo === "42501") {
    return "Seu perfil não tem permissão para esta ação. Peça a um administrador ou use a tela indicada para a operação.";
  }
  if (codigo === "23505") {
    return "Já existe outro registro com este endereço (slug) ou código. Escolha outro para não conflitar no site.";
  }
  if (codigo === "23514") {
    return "Faltam informações obrigatórias para salvar. Revise os campos destacados e tente de novo.";
  }
  if (!bruto) return "Não foi possível concluir. Tente novamente.";
  return bruto;
}

export const STATUS_OPTIONS = [
  { value: "rascunho", label: "Rascunho" },
  { value: "revisao", label: "Em revisão" },
  { value: "publicado", label: "Publicado" },
  { value: "arquivado", label: "Arquivado" },
];

export const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI",
  "RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

/** Slug estável a partir do nome; não altera zeros à esquerda de códigos. */
export function slugify(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Converte "12,90" ou "1290" em centavos inteiros. Vazio vira null. */
export function parseCentavos(entrada: string): number | null {
  const limpo = entrada.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const valor = Number(limpo);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

export function centavosParaTexto(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

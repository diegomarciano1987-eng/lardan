import { supabase } from "@/integrations/supabase/client";

/** Filtros da Central da Vitrine. Tudo é resolvido no servidor. */
export interface ShowcaseFilters {
  busca?: string | undefined;
  categoria_id?: string | undefined;
  colecao_id?: string | undefined;
  fornecedor_id?: string | undefined;
  status?: string | undefined;
  publicado?: boolean | undefined;
  preco_publico?: boolean | undefined;
  com_imagem?: boolean | undefined;
  com_preco?: boolean | undefined;
  com_estoque?: boolean | undefined;
  destaque?: boolean | undefined;
  lancamento?: boolean | undefined;
  agendado?: boolean | undefined;
  completo?: boolean | undefined;
  sem_categoria?: boolean | undefined;
  criado_de?: string | undefined;
  criado_ate?: string | undefined;
  atualizado_de?: string | undefined;
  atualizado_ate?: string | undefined;
  preco_min?: number | undefined;
  preco_max?: number | undefined;
  material?: string | undefined;
  banho?: string | undefined;
  tag?: string | undefined;
}

export type ShowcaseSort =
  | "updated_desc"
  | "criado_desc"
  | "nome_asc"
  | "nome_desc"
  | "preco_asc"
  | "preco_desc"
  | "estoque_desc";

export interface ShowcaseRow {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  status: "rascunho" | "revisao" | "publicado" | "arquivado";
  price_cents: number | null;
  price_is_public: boolean;
  is_featured: boolean;
  is_new_arrival: boolean;
  scheduled_publish_at: string | null;
  updated_at: string;
  created_at: string;
  category_id: string | null;
  category_name: string | null;
  collection_id: string | null;
  collection_name: string | null;
  supplier_name: string | null;
  material: string | null;
  plating: string | null;
  tags: string[];
  cover_media_id: string | null;
  cover_alt: string | null;
  estoque: number;
  faltando: string[];
  total: number;
}

export interface ShowcaseCounts {
  total: number;
  publicados: number;
  aguardando: number;
  incompletos: number;
  sem_imagem: number;
  sem_preco: number;
  sem_categoria: number;
  sem_estoque: number;
  destaques: number;
  agendados: number;
  alterados_7d: number;
}

/** Campos que impedem a publicação quando ausentes. */
export const ESSENCIAIS = [
  "nome",
  "slug",
  "categoria",
  "descricao",
  "imagem",
  "texto_alternativo",
  "preco",
] as const;

export const CHECKLIST_LABEL: Record<string, string> = {
  nome: "Nome",
  slug: "Endereço (slug)",
  categoria: "Categoria",
  descricao: "Descrição",
  imagem: "Imagem principal",
  texto_alternativo: "Texto alternativo da imagem",
  preco: "Preço",
  material: "Material",
  medidas: "Medidas",
  cuidados: "Cuidados",
  garantia: "Garantia",
};

export type Prontidao =
  | "publicado"
  | "agendado"
  | "arquivado"
  | "pronto"
  | "quase"
  | "incompleto";

export const PRONTIDAO_LABEL: Record<Prontidao, string> = {
  publicado: "Publicado",
  agendado: "Agendado",
  arquivado: "Arquivado",
  pronto: "Pronto para publicar",
  quase: "Quase pronto",
  incompleto: "Incompleto",
};

export function prontidao(row: ShowcaseRow): Prontidao {
  if (row.status === "publicado") return "publicado";
  if (row.status === "arquivado") return "arquivado";
  if (row.scheduled_publish_at) return "agendado";
  const bloqueios = row.faltando.filter((f) => (ESSENCIAIS as readonly string[]).includes(f));
  if (bloqueios.length > 0) return "incompleto";
  if (row.faltando.length > 0) return "quase";
  return "pronto";
}

export function bloqueios(row: ShowcaseRow) {
  return row.faltando.filter((f) => (ESSENCIAIS as readonly string[]).includes(f));
}

/** Remove chaves vazias antes de mandar ao banco. */
export function limparFiltros(f: ShowcaseFilters): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    saida[k] = v;
  }
  return saida;
}

export async function fetchShowcaseCounts(): Promise<ShowcaseCounts> {
  const { data, error } = await supabase.rpc("showcase_counts");
  if (error) throw error;
  return data as unknown as ShowcaseCounts;
}

export async function listShowcase(params: {
  filtros: ShowcaseFilters;
  ordem: ShowcaseSort;
  pagina: number;
  porPagina: number;
}): Promise<{ rows: ShowcaseRow[]; total: number }> {
  const { data, error } = await supabase.rpc("showcase_list", {
    _f: limparFiltros(params.filtros) as never,
    _sort: params.ordem,
    _limit: params.porPagina,
    _offset: params.pagina * params.porPagina,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as ShowcaseRow[];
  return { rows, total: rows[0]?.total ? Number(rows[0].total) : 0 };
}

/** Todos os ids do conjunto encontrado — para seleção por filtro. */
export async function showcaseIds(filtros: ShowcaseFilters, max = 5000): Promise<string[]> {
  const { data, error } = await supabase.rpc("showcase_ids", {
    _f: limparFiltros(filtros) as never,
    _max: max,
  });
  if (error) throw error;
  return (data ?? []) as string[];
}

export type BulkAction =
  | "publicar"
  | "despublicar"
  | "arquivar"
  | "mostrar_preco"
  | "esconder_preco"
  | "definir_categoria"
  | "adicionar_colecao"
  | "remover_colecao"
  | "destacar"
  | "remover_destaque"
  | "lancamento"
  | "remover_lancamento"
  | "programar"
  | "cancelar_agendamento"
  | "estoque_visibilidade";

export const BULK_LABEL: Record<BulkAction, string> = {
  publicar: "Publicar",
  despublicar: "Despublicar",
  arquivar: "Arquivar",
  mostrar_preco: "Mostrar preço no site",
  esconder_preco: "Esconder preço no site",
  definir_categoria: "Definir categoria",
  adicionar_colecao: "Adicionar à coleção",
  remover_colecao: "Remover da coleção",
  destacar: "Marcar como destaque",
  remover_destaque: "Remover destaque",
  lancamento: "Definir como lançamento",
  remover_lancamento: "Remover lançamento",
  programar: "Programar publicação",
  cancelar_agendamento: "Cancelar agendamento",
  estoque_visibilidade: "Estratégia quando zerar o estoque",
};

export interface BulkResult {
  lote_id: string;
  afetados: number;
  rejeitados: number;
  itens_rejeitados: { id: string; nome: string; faltando: string[] }[];
  repetido: boolean;
}

export async function runBulk(params: {
  acao: BulkAction;
  ids: string[];
  params?: Record<string, unknown>;
  filtros?: ShowcaseFilters;
  chave: string;
  nota?: string;
}): Promise<BulkResult> {
  const { data, error } = await supabase.rpc("showcase_bulk", {
    _action: params.acao,
    _ids: params.ids,
    _params: (params.params ?? {}) as never,
    _filters: limparFiltros(params.filtros ?? {}) as never,
    _idempotency_key: params.chave,
    _note: params.nota ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as BulkResult;
}

export interface BatchRow {
  id: string;
  action: string;
  affected: number;
  rejected: number;
  created_at: string;
  params: Record<string, unknown>;
  filters: Record<string, unknown>;
}

export async function listBatches(limit = 20): Promise<BatchRow[]> {
  const { data, error } = await supabase
    .from("showcase_batches")
    .select("id, action, affected, rejected, created_at, params, filters")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as BatchRow[];
}

export interface OpcaoSimples {
  id: string;
  name: string;
}

export async function listCategoriasSimples(): Promise<OpcaoSimples[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .order("position");
  if (error) throw error;
  return (data ?? []) as OpcaoSimples[];
}

export async function listColecoesSimples(): Promise<OpcaoSimples[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, name")
    .order("position");
  if (error) throw error;
  return (data ?? []) as OpcaoSimples[];
}

export async function listFornecedoresSimples(): Promise<OpcaoSimples[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as OpcaoSimples[];
}

export interface SavedView {
  id: string;
  name: string;
  filters: ShowcaseFilters;
  is_shared: boolean;
}

export async function listSavedViews(): Promise<SavedView[]> {
  const { data, error } = await supabase
    .from("showcase_views")
    .select("id, name, filters, is_shared")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as SavedView[];
}

export async function saveView(nome: string, filtros: ShowcaseFilters, compartilhada: boolean) {
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("showcase_views").insert({
    name: nome,
    filters: limparFiltros(filtros) as never,
    is_shared: compartilhada,
    created_by: user.user?.id ?? null,
  });
  if (error) throw error;
}

export async function deleteView(id: string) {
  const { error } = await supabase.from("showcase_views").delete().eq("id", id);
  if (error) throw error;
}

// ===================== Categorias, coleções e home =====================

export interface Taxonomia {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
  position: number;
  status: "rascunho" | "revisao" | "publicado" | "arquivado";
  hero_media_id: string | null;
  parent_id?: string | null;
}

export type TipoTaxonomia = "categories" | "collections";

export async function listTaxonomia(tipo: TipoTaxonomia): Promise<Taxonomia[]> {
  const colunas =
    tipo === "categories"
      ? "id, slug, name, description, seo_title, seo_description, position, status, hero_media_id, parent_id"
      : "id, slug, name, description, seo_title, seo_description, position, status, hero_media_id";
  const { data, error } = await supabase.from(tipo).select(colunas).order("position");
  if (error) throw error;
  return (data ?? []) as unknown as Taxonomia[];
}

export async function saveTaxonomia(tipo: TipoTaxonomia, id: string, valores: Partial<Taxonomia>) {
  const { error } = await supabase
    .from(tipo)
    .update({ ...valores, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}

/** Curadoria da página inicial, guardada em site_settings. */
export interface HomeBloco {
  chave: "lancamentos" | "destaques" | "colecoes" | "categorias";
  titulo: string;
  visivel: boolean;
  ordem: number;
  itens: string[];
  agendado_para?: string | null;
}

export const HOME_PADRAO: HomeBloco[] = [
  { chave: "lancamentos", titulo: "Lançamentos", visivel: false, ordem: 1, itens: [] },
  { chave: "destaques", titulo: "Em destaque", visivel: false, ordem: 2, itens: [] },
  { chave: "colecoes", titulo: "Coleções em evidência", visivel: false, ordem: 3, itens: [] },
  { chave: "categorias", titulo: "Categorias principais", visivel: false, ordem: 4, itens: [] },
];

export async function getHomeCuration(): Promise<HomeBloco[]> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "home_curation")
    .maybeSingle();
  if (error) throw error;
  const valor = (data?.value ?? null) as unknown as { blocos?: HomeBloco[] } | null;
  return valor?.blocos?.length ? valor.blocos : HOME_PADRAO;
}

export async function saveHomeCuration(blocos: HomeBloco[]) {
  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("site_settings").upsert(
    {
      key: "home_curation",
      value: { blocos } as never,
      is_public: true,
      updated_by: user.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw error;
}

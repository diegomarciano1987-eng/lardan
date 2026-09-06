import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

/** Campos canônicos que o sistema entende. */
export const CAMPOS = [
  { key: "nome", label: "Nome do produto", obrigatorio: true },
  { key: "sku", label: "SKU / referência" },
  { key: "codigo_legado", label: "Código legado (sistema antigo)" },
  { key: "ean", label: "Código de barras (EAN/GTIN)" },
  { key: "categoria", label: "Categoria" },
  { key: "subcategoria", label: "Subcategoria" },
  { key: "colecao", label: "Coleção / linha" },
  { key: "fornecedor", label: "Fornecedor" },
  { key: "marca", label: "Marca" },
  { key: "material", label: "Material" },
  { key: "banho", label: "Banho" },
  { key: "cor", label: "Cor" },
  { key: "tamanho", label: "Tamanho" },
  { key: "peso", label: "Peso (gramas)" },
  { key: "medidas", label: "Medidas" },
  { key: "descricao_curta", label: "Descrição curta" },
  { key: "descricao", label: "Descrição completa" },
  { key: "custo", label: "Valor de custo" },
  { key: "preco", label: "Preço de venda" },
  { key: "quantidade", label: "Quantidade" },
  { key: "destaque", label: "Destaque (sim/não)" },
  { key: "publicar", label: "Publicar no site (sim/não)" },
  { key: "mostrar_preco", label: "Mostrar preço no site (sim/não)" },
  { key: "imagem_url", label: "Endereço da imagem" },
] as const;

export type CampoKey = (typeof CAMPOS)[number]["key"];

/** Apelidos aceitos por campo, para o de-para automático. */
const APELIDOS: Record<CampoKey, string[]> = {
  nome: ["nome", "produto", "nome do produto", "descricao do produto", "peca", "titulo"],
  sku: ["sku", "codigo", "codigo interno", "referencia", "ref", "cod"],
  codigo_legado: ["codigo legado", "codigo antigo", "id antigo", "codigo sistema antigo", "legado"],
  ean: ["codigo de barras", "barcode", "ean", "ean13", "gtin", "cod barras"],
  categoria: ["categoria", "grupo"],
  subcategoria: ["subcategoria", "subgrupo"],
  colecao: ["colecao", "linha", "familia"],
  fornecedor: ["fornecedor", "supplier"],
  marca: ["marca"],
  material: ["material", "materia prima"],
  banho: ["banho", "acabamento", "plating"],
  cor: ["cor", "cores"],
  tamanho: ["tamanho", "tam", "aro", "numero"],
  peso: ["peso", "peso gramas", "peso g", "gramas"],
  medidas: ["medidas", "dimensoes", "medida"],
  descricao_curta: ["descricao curta", "resumo", "chamada"],
  descricao: ["descricao", "descricao completa", "detalhes"],
  custo: ["valor de custo", "custo", "preco de custo", "valor custo", "custo unitario"],
  preco: ["preco", "valor", "preco de venda", "valor de venda", "preco venda", "preco publico"],
  quantidade: ["quantidade", "qtd", "estoque", "saldo", "quantidades", "qtde"],
  destaque: ["destaque", "featured"],
  publicar: ["publicar", "publicado", "ativo no site"],
  mostrar_preco: ["mostrar preco", "preco publico", "exibir preco"],
  imagem_url: ["imagem", "imagem url", "foto", "url da imagem", "link da imagem"],
};

export function normalizarCabecalho(h: string) {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface PlanilhaLida {
  cabecalhos: string[];
  linhas: Record<string, string>[];
}

/**
 * Lê a planilha preservando texto: SKU, código de barras e código legado
 * nunca perdem zeros à esquerda nem viram notação científica.
 */
export function lerPlanilha(buffer: ArrayBuffer): PlanilhaLida {
  const wb = XLSX.read(buffer, { type: "array", raw: false, cellDates: false });
  const nome = wb.SheetNames[0];
  const sheet = nome ? wb.Sheets[nome] : undefined;
  if (!sheet) return { cabecalhos: [], linhas: [] };
  const matriz = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  const cabecalhos = (matriz[0] ?? []).map((c) => String(c ?? "").trim());
  const linhas: Record<string, string>[] = [];
  for (let i = 1; i < matriz.length; i += 1) {
    const bruta = matriz[i] ?? [];
    const registro: Record<string, string> = {};
    let vazia = true;
    cabecalhos.forEach((cab, idx) => {
      if (!cab) return;
      const valor = String(bruta[idx] ?? "").trim();
      registro[cab] = valor;
      if (valor !== "") vazia = false;
    });
    if (!vazia) linhas.push(registro);
  }
  return { cabecalhos: cabecalhos.filter(Boolean), linhas };
}

/** Sugere o de-para entre colunas da planilha e campos do sistema. */
export function sugerirMapeamento(cabecalhos: string[]): Partial<Record<CampoKey, string>> {
  const porNorma = new Map<string, string>();
  for (const c of cabecalhos) porNorma.set(normalizarCabecalho(c), c);
  const mapa: Partial<Record<CampoKey, string>> = {};
  for (const campo of CAMPOS) {
    for (const apelido of APELIDOS[campo.key]) {
      const achado = porNorma.get(apelido);
      if (achado) {
        mapa[campo.key] = achado;
        break;
      }
    }
  }
  return mapa;
}

export interface JobResumo {
  id: string;
  job_key: string;
  file_name: string;
  mode: string;
  status: string;
  dry_run: boolean;
  total_rows: number;
  processed_rows: number;
  ok_rows: number;
  warn_rows: number;
  error_rows: number;
  products_created: number;
  products_updated: number;
  variants_created: number;
  variants_updated: number;
  stock_entries: number;
  units_in: number;
  reference: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface LinhaProblema {
  line_no: number;
  status: string;
  messages: { campo?: string; erro?: string; aviso?: string }[];
  raw: Record<string, unknown>;
}

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function abrirLote(params: {
  jobKey: string;
  fileName: string;
  fileSize: number;
  mode: "catalogo" | "entrada";
  mapping: Record<string, string>;
  defaults: Record<string, string>;
  locationId?: string | null;
  operationDate?: string | null;
  reasonCode?: string | null;
  reference?: string | null;
  dryRun: boolean;
}): Promise<string> {
  const { data, error } = await rpc("import_job_open", {
    _job_key: params.jobKey,
    _file_name: params.fileName,
    _file_size: params.fileSize,
    _mode: params.mode,
    _mapping: params.mapping,
    _defaults: params.defaults,
    _location_id: params.locationId ?? null,
    _operation_date: params.operationDate ?? null,
    _reason_code: params.reasonCode ?? null,
    _reference: params.reference ?? null,
    _dry_run: params.dryRun,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function enviarLinhas(jobId: string, linhas: { n: number; raw: Record<string, string> }[]) {
  const { error } = await rpc("import_rows_stage", { _job: jobId, _rows: linhas });
  if (error) throw new Error(error.message);
}

export async function validarLote(jobId: string, limite = 500) {
  const { data, error } = await rpc("import_job_validate", { _job: jobId, _limit: limite });
  if (error) throw new Error(error.message);
  return data as { validadas: number; restantes: number };
}

export async function processarLote(jobId: string, limite = 200) {
  const { data, error } = await rpc("import_job_process", { _job: jobId, _limit: limite });
  if (error) throw new Error(error.message);
  return data as {
    processadas: number;
    erros_no_lote: number;
    restantes: number;
    produtos_criados: number;
    produtos_atualizados: number;
    variantes_criadas: number;
    variantes_atualizadas: number;
    entradas: number;
    unidades: number;
  };
}

export async function cancelarLote(jobId: string) {
  const { error } = await rpc("import_job_cancel", { _job: jobId });
  if (error) throw new Error(error.message);
}

export async function lerLote(jobId: string): Promise<JobResumo> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as JobResumo;
}

export async function listarLotes(limite = 20): Promise<JobResumo[]> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as JobResumo[];
}

export async function listarProblemas(jobId: string, limite = 500): Promise<LinhaProblema[]> {
  const { data, error } = await supabase
    .from("import_rows")
    .select("line_no,status,messages,raw")
    .eq("job_id", jobId)
    .in("status", ["erro", "conflito"])
    .order("line_no")
    .limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LinhaProblema[];
}

/** Baixa uma planilha só com as linhas recusadas e o motivo, pronta para corrigir e reenviar. */
export function baixarPlanilhaDeErros(problemas: LinhaProblema[], nomeArquivo: string) {
  const dados = problemas.map((p) => ({
    Linha: p.line_no,
    Situação: p.status === "conflito" ? "Conflito de código" : "Erro",
    Motivo: (p.messages ?? [])
      .map((m) => m.erro ?? m.aviso ?? "")
      .filter(Boolean)
      .join(" | "),
    ...(p.raw as Record<string, string>),
  }));
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Linhas recusadas");
  XLSX.writeFile(wb, nomeArquivo);
}

/** Planilha-modelo com os cabeçalhos oficiais e uma linha de exemplo. */
export function baixarModelo() {
  const exemplo: Record<string, string | number> = {
    "Nome do produto": "Anel Solitário Cristal",
    SKU: "AN-0001",
    "Código legado": "0012345",
    "Código de barras": "7890000000017",
    Categoria: "Anéis",
    Coleção: "Clássicos",
    Fornecedor: "Fornecedor Exemplo",
    Material: "Latão",
    Banho: "Ouro 18k",
    Cor: "Dourado",
    Tamanho: "17",
    "Peso (gramas)": "3,4",
    Medidas: "Aro 17mm",
    "Valor de custo": "29,90",
    "Preço de venda": "79,90",
    Quantidade: 10,
    "Publicar no site": "não",
    "Mostrar preço no site": "sim",
  };
  const ws = XLSX.utils.json_to_sheet([exemplo]);
  ws["!cols"] = Object.keys(exemplo).map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");
  XLSX.writeFile(wb, "modelo-importacao-lardan.xlsx");
}

/**
 * LARDAN Cloud — motor de importação industrial (lado navegador).
 *
 * Arquivo (identidade calculada no servidor) → Execução (o que será feito com
 * ele) → recepção das linhas → validação → simulação ou execução real →
 * pausa, retomada, cancelamento com motivo.
 *
 * Nada aqui grava direto no catálogo: todas as operações passam por funções
 * do banco com permissão, máquina de estados e reserva de linha.
 */
import { supabase } from "@/integrations/supabase/client";
import { celulaSegura, lerPlanilha } from "./importacao/parser";

export { LIMITES, PARSER_VERSION, lerPlanilha } from "./importacao/parser";
export type { PlanilhaLida } from "./importacao/parser";

/** Campos canônicos que o sistema entende. */
export const CAMPOS = [
  // produto-base
  { key: "nome", label: "Nome do produto", obrigatorio: true, alvo: "produto" },
  { key: "codigo_interno", label: "Código interno (LAR-…)", alvo: "produto" },
  { key: "codigo_legado_produto", label: "Código legado do produto", alvo: "produto" },
  { key: "categoria", label: "Categoria", alvo: "produto" },
  { key: "subcategoria", label: "Subcategoria", alvo: "produto" },
  { key: "colecao", label: "Coleção / linha", alvo: "produto" },
  { key: "material_bruto", label: "Material bruto", alvo: "produto" },
  { key: "peso_bruto", label: "Peso bruto (gramas)", alvo: "produto" },
  { key: "fornecedor_bruto", label: "Fornecedor do bruto", alvo: "produto" },
  { key: "valor_bruto", label: "Valor da peça no bruto", alvo: "produto" },
  { key: "medidas", label: "Medidas", alvo: "produto" },
  { key: "resumo", label: "Resumo", alvo: "produto" },
  { key: "descricao", label: "Descrição completa", alvo: "produto" },
  { key: "cuidados", label: "Cuidados", alvo: "produto" },
  { key: "garantia", label: "Garantia", alvo: "produto" },
  { key: "seo_titulo", label: "Título para buscadores", alvo: "produto" },
  { key: "seo_descricao", label: "Descrição para buscadores", alvo: "produto" },
  { key: "preco", label: "Preço-base", alvo: "produto" },
  { key: "publicar_preco", label: "Publicar preço (sim/não)", alvo: "produto" },
  { key: "destaque", label: "Destaque (sim/não)", alvo: "produto" },
  { key: "publicar", label: "Publicar no site (sim/não)", alvo: "produto" },
  // variante
  { key: "nome_variante", label: "Nome da variante", alvo: "variante" },
  { key: "sku", label: "SKU / referência", alvo: "variante" },
  { key: "ean", label: "Código de barras (EAN/GTIN)", alvo: "variante" },
  { key: "codigo_legado", label: "Código legado da variante", alvo: "variante" },
  { key: "tipo_banho", label: "Tipo de banho", alvo: "variante" },
  { key: "cor", label: "Cor", alvo: "variante" },
  { key: "tamanho", label: "Tamanho / aro", alvo: "variante" },
  { key: "fornecedor_banho", label: "Fornecedor do banho", alvo: "variante" },
  { key: "valor_banho", label: "Valor do material do banho", alvo: "variante" },
  { key: "verniz", label: "Verniz", alvo: "variante" },
  { key: "valor_verniz", label: "Valor do verniz", alvo: "variante" },
  { key: "valor_final", label: "Valor final da peça banhada", alvo: "variante" },
  { key: "peso_final", label: "Peso final (gramas)", alvo: "variante" },
  { key: "preco_variante", label: "Preço da variante", alvo: "variante" },
  { key: "variante_padrao", label: "Variante padrão (sim/não)", alvo: "variante" },
  { key: "variante_ativa", label: "Variante ativa (sim/não)", alvo: "variante" },
  { key: "justificativa_custo", label: "Justificativa do custo", alvo: "variante" },
  { key: "observacao_custo", label: "Observação do custo", alvo: "variante" },
  // legado — continuam aceitos nas planilhas antigas
  { key: "material", label: "Material (planilha antiga)", alvo: "produto" },
  { key: "banho", label: "Banho (planilha antiga)", alvo: "produto" },
  { key: "peso", label: "Peso em gramas (planilha antiga)", alvo: "produto" },
  { key: "fornecedor", label: "Fornecedor (planilha antiga)", alvo: "produto" },
  { key: "descricao_curta", label: "Descrição curta (planilha antiga)", alvo: "produto" },
  { key: "custo", label: "Valor de custo (planilha antiga)", alvo: "variante" },
  { key: "mostrar_preco", label: "Mostrar preço (planilha antiga)", alvo: "produto" },
  { key: "quantidade", label: "Quantidade", alvo: "estoque" },
  { key: "imagem_url", label: "Endereço da imagem", alvo: "produto" },
] as const;

export type CampoKey = (typeof CAMPOS)[number]["key"];

/** Campos que só existem no modelo novo — servem para reconhecer o formato. */
export const CAMPOS_NOVOS: CampoKey[] = [
  "codigo_interno",
  "subcategoria",
  "material_bruto",
  "peso_bruto",
  "fornecedor_bruto",
  "valor_bruto",
  "cuidados",
  "garantia",
  "seo_titulo",
  "seo_descricao",
  "nome_variante",
  "fornecedor_banho",
  "valor_banho",
  "verniz",
  "valor_verniz",
  "valor_final",
  "peso_final",
  "preco_variante",
  "variante_padrao",
  "variante_ativa",
  "codigo_legado_produto",
];

export function formatoDaPlanilha(mapa: Partial<Record<CampoKey, string>>): "novo" | "legado" {
  return CAMPOS_NOVOS.some((k) => (mapa[k] ?? "").trim() !== "") ? "novo" : "legado";
}

const APELIDOS: Record<CampoKey, string[]> = {
  nome: ["nome", "produto", "nome produto", "nome do produto", "descricao do produto", "peca", "titulo"],
  codigo_interno: ["codigo interno", "codigo lardan", "cod interno"],
  codigo_legado_produto: ["codigo legado do produto", "codigo legado produto", "legado produto"],
  categoria: ["categoria", "grupo"],
  subcategoria: ["subcategoria", "sub categoria", "subgrupo"],
  colecao: ["colecao", "linha", "familia"],
  material_bruto: ["material bruto", "materia prima bruta"],
  peso_bruto: ["peso bruto", "peso do bruto"],
  fornecedor_bruto: ["fornecedor bruto", "fornecedor do bruto"],
  valor_bruto: ["valor bruto", "custo bruto", "valor da peca no bruto", "valor do bruto"],
  medidas: ["medidas", "dimensoes", "medida"],
  resumo: ["resumo", "chamada"],
  descricao: ["descricao", "descricao completa", "detalhes"],
  cuidados: ["cuidados", "como cuidar", "conservacao"],
  garantia: ["garantia"],
  seo_titulo: ["titulo para buscadores", "seo titulo", "titulo seo"],
  seo_descricao: ["descricao para buscadores", "seo descricao", "descricao seo"],
  preco: ["preco", "valor", "preco base", "preco de venda", "valor de venda", "preco venda"],
  publicar_preco: ["publicar preco", "preco publico", "exibir preco"],
  destaque: ["destaque", "featured"],
  publicar: ["publicar", "publicado", "ativo no site"],
  nome_variante: ["nome da variante", "nome variante", "variante"],
  sku: ["sku", "codigo", "referencia", "ref", "cod"],
  ean: ["codigo de barras", "barcode", "ean", "ean13", "gtin", "cod barras"],
  codigo_legado: ["codigo legado", "codigo antigo", "id antigo", "codigo sistema antigo", "legado"],
  tipo_banho: ["tipo de banho", "tipo banho"],
  cor: ["cor", "cores"],
  tamanho: ["tamanho", "tam", "aro", "numero"],
  fornecedor_banho: ["fornecedor banho", "fornecedor do banho"],
  valor_banho: ["valor banho", "custo banho", "valor do banho", "valor do material do banho"],
  verniz: ["verniz"],
  valor_verniz: ["valor verniz", "custo verniz", "valor do verniz"],
  valor_final: ["valor final", "custo final", "valor banhada", "valor final da peca banhada"],
  peso_final: ["peso final", "peso da peca banhada"],
  preco_variante: ["preco da variante", "preco variante"],
  variante_padrao: ["variante padrao", "padrao"],
  variante_ativa: ["variante ativa", "ativa"],
  justificativa_custo: ["justificativa do custo", "justificativa custo", "justificativa"],
  observacao_custo: ["observacao do custo", "observacao custo", "obs custo"],
  material: ["material", "materia prima"],
  banho: ["banho", "acabamento", "plating"],
  peso: ["peso", "peso gramas", "peso g", "gramas"],
  fornecedor: ["fornecedor", "supplier"],
  descricao_curta: ["descricao curta"],
  custo: ["valor de custo", "custo", "preco de custo", "valor custo", "custo unitario"],
  mostrar_preco: ["mostrar preco"],
  quantidade: ["quantidade", "qtd", "estoque", "saldo", "quantidades", "qtde"],
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

export interface SugestaoCampo {
  campo: CampoKey;
  coluna: string;
  confianca: "exata" | "duvida";
}

/**
 * Sugere o de-para apenas por correspondência exata de apelido. Quando uma
 * coluna serve a mais de um campo, ela vira dúvida e não é preenchida sozinha:
 * a pessoa confirma na tela.
 */
export function sugerirMapeamentoDetalhado(cabecalhos: string[]): SugestaoCampo[] {
  const porNorma = new Map<string, string>();
  for (const c of cabecalhos) porNorma.set(normalizarCabecalho(c), c);

  const candidatos = new Map<string, CampoKey[]>();
  for (const campo of CAMPOS) {
    for (const apelido of APELIDOS[campo.key]) {
      const coluna = porNorma.get(apelido);
      if (!coluna) continue;
      candidatos.set(coluna, [...(candidatos.get(coluna) ?? []), campo.key]);
      break;
    }
  }

  const saida: SugestaoCampo[] = [];
  const usados = new Set<CampoKey>();
  for (const [coluna, campos] of candidatos) {
    if (campos.length === 1) {
      const c = campos[0]!;
      if (usados.has(c)) continue;
      usados.add(c);
      saida.push({ campo: c, coluna, confianca: "exata" });
    } else {
      for (const c of campos) saida.push({ campo: c, coluna, confianca: "duvida" });
    }
  }
  return saida;
}

/** Campos em que a planilha deixou dúvida: a coluna serve a mais de um campo. */
export function duvidasDeMapeamento(cabecalhos: string[]): SugestaoCampo[] {
  return sugerirMapeamentoDetalhado(cabecalhos).filter((s) => s.confianca === "duvida");
}


export function sugerirMapeamento(cabecalhos: string[]): Partial<Record<CampoKey, string>> {
  const mapa: Partial<Record<CampoKey, string>> = {};
  for (const s of sugerirMapeamentoDetalhado(cabecalhos)) mapa[s.campo] = s.coluna;
  return mapa;
}

/** Colunas apontadas por mais de um campo — ambiguidade nunca é silenciosa. */
export function colunasAmbiguas(mapa: Partial<Record<CampoKey, string>>): string[] {
  const contagem = new Map<string, number>();
  for (const v of Object.values(mapa)) {
    if (!v) continue;
    contagem.set(v, (contagem.get(v) ?? 0) + 1);
  }
  return [...contagem.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}

/* ------------------------------------------------------------- tipos --- */

export type EstadoLote =
  | "rascunho"
  | "recebendo"
  | "recebido"
  | "validando"
  | "pronto"
  | "simulando"
  | "simulado"
  | "processando"
  | "pausando"
  | "pausado"
  | "concluido"
  | "concluido_com_erros"
  | "falhou"
  | "cancelado";

export const ROTULO_ESTADO: Record<EstadoLote, string> = {
  rascunho: "Rascunho",
  recebendo: "Recebendo linhas",
  recebido: "Arquivo recebido",
  validando: "Conferindo",
  pronto: "Pronto para executar",
  simulando: "Simulando",
  simulado: "Simulação concluída",
  processando: "Processando",
  pausando: "Pausando…",
  pausado: "Pausado",
  concluido: "Concluído",
  concluido_com_erros: "Concluído com recusas",
  falhou: "Falhou",
  cancelado: "Cancelado",
};

export const ESTADOS_ENCERRADOS: EstadoLote[] = ["concluido", "concluido_com_erros", "cancelado"];

export interface JobResumo {
  id: string;
  job_key: string;
  file_id: string | null;
  file_name: string;
  file_size: number | null;
  mode: "catalogo" | "entrada";
  status: EstadoLote;
  dry_run: boolean;
  mapping: Record<string, string>;
  defaults: Record<string, string>;
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
  checkpoint_line: number;
  cancel_reason: string | null;
  simulation_of: string | null;
  correction_of: string | null;
  reference: string | null;
  location_id: string | null;
  operation_date: string | null;
  reason_code: string | null;
  rules_version: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Indicadores {
  total: number;
  pendentes: number;
  prontas: number;
  avisos: number;
  recusadas: number;
  conflitos: number;
  em_curso: number;
  simuladas: number;
  processadas: number;
  ignoradas: number;
  produtos_criados: number;
  produtos_atualizados: number;
  variantes_criadas: number;
  variantes_atualizadas: number;
  categorias_criadas: number;
  colecoes_criadas: number;
  fornecedores_criados: number;
  custos: number;
  entradas: number;
  unidades: number;
  publicacoes: number;
  publicacoes_recusadas: number;
}

export interface LinhaProblema {
  line_no: number;
  status: string;
  messages: { campo?: string; erro?: string; aviso?: string; correcao?: string }[];
  raw: Record<string, unknown>;
}

const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/* ------------------------------------------------------ arquivo/lote --- */

/** Envia o conteúdo ao servidor, que calcula a impressão digital e registra o arquivo. */
export async function registrarArquivoNoServidor(file: File) {
  const { registrarArquivo } = await import("./importacao/arquivo.functions");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    bin += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return registrarArquivo({
    data: { nome: file.name, tipo: file.type ?? "", conteudo: btoa(bin) },
  });
}

export interface AberturaLote {
  fileId: string;
  mode: "catalogo" | "entrada";
  mapping: Record<string, string>;
  defaults?: Record<string, string>;
  dryRun: boolean;
  locationId?: string | null;
  operationDate?: string | null;
  reasonCode?: string | null;
  reference?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
  correctionOf?: string | null;
}

export async function abrirExecucao(p: AberturaLote) {
  return chamar<{ id: string; reaproveitado: boolean; status: EstadoLote; chave: string }>(
    "import_job_open2",
    {
      _file: p.fileId,
      _mode: p.mode,
      _mapping: p.mapping,
      _defaults: p.defaults ?? {},
      _dry_run: p.dryRun,
      _location_id: p.locationId ?? null,
      _operation_date: p.operationDate ?? null,
      _reason_code: p.reasonCode ?? null,
      _reference: p.reference ?? null,
      _template_id: p.templateId ?? null,
      _template_version: p.templateVersion ?? null,
      _simulation_of: null,
      _correction_of: p.correctionOf ?? null,
    },
  );
}

export async function enviarLinhas(
  jobId: string,
  linhas: { n: number; raw: Record<string, string> }[],
) {
  return chamar<number>("import_rows_stage", { _job: jobId, _rows: linhas });
}

export async function selarLote(jobId: string) {
  return chamar<{ linhas: number }>("import_job_seal", { _job: jobId });
}

export async function validarLote(jobId: string, limite = 500) {
  return chamar<{ validadas: number; restantes: number; indicadores: Indicadores }>(
    "import_job_validate",
    { _job: jobId, _limit: limite },
  );
}

export async function processarLote(jobId: string, limite = 200, worker?: string) {
  return chamar<{
    processadas: number;
    erros_no_lote: number;
    restantes: number;
    pausado?: boolean;
    worker: string;
    indicadores: Indicadores;
  }>("import_job_process", { _job: jobId, _limit: limite, _worker: worker ?? null });
}

export async function pausarLote(jobId: string) {
  return chamar<{ status: EstadoLote }>("import_job_pause", { _job: jobId });
}

export async function retomarLote(jobId: string) {
  return chamar<{ status: EstadoLote; linhas_liberadas: number }>("import_job_resume", {
    _job: jobId,
  });
}

export async function cancelarLote(jobId: string, motivo: string) {
  return chamar<{ status: EstadoLote; ja_aplicado: Indicadores }>("import_job_cancel", {
    _job: jobId,
    _motivo: motivo,
  });
}

export async function promoverSimulacao(jobId: string) {
  return chamar<{ id: string; base_mudou: boolean; status: EstadoLote }>("import_job_promote", {
    _job: jobId,
  });
}

export async function indicadoresLote(jobId: string) {
  return chamar<Indicadores>("import_job_counters", { _job: jobId });
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

/** Lote aberto que o usuário pode retomar ao recarregar a página. */
export async function loteRetomavel(): Promise<JobResumo | null> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .not("status", "in", "(concluido,concluido_com_erros,cancelado)")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as unknown as JobResumo) ?? null;
}

export async function listarProblemas(jobId: string, limite = 2000): Promise<LinhaProblema[]> {
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

/* --------------------------------------------------------- planilhas --- */

const CAMPOS_SENSIVEIS = ["custo", "valor de custo", "preco de custo", "custo unitario"];

/**
 * Planilha das linhas recusadas: todas as colunas originais, mais linha,
 * situação, campo, motivo e orientação. Pronta para corrigir e reenviar.
 * Nenhuma célula pode virar fórmula ao abrir no Excel.
 */
export async function baixarPlanilhaDeErros(
  problemas: LinhaProblema[],
  nomeArquivo: string,
  opcoes: { podeVerCusto?: boolean } = {},
) {
  const XLSX = await import("xlsx");
  const dados = problemas.map((p) => {
    const bruto: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.raw as Record<string, unknown>)) {
      if (!opcoes.podeVerCusto && CAMPOS_SENSIVEIS.includes(normalizarCabecalho(k))) continue;
      bruto[k] = celulaSegura(v);
    }
    const msgs = p.messages ?? [];
    return {
      "Linha original": p.line_no,
      Situação: p.status === "conflito" ? "Conflito de código" : "Recusada",
      Campo: msgs
        .map((m) => m.campo ?? "")
        .filter(Boolean)
        .join(" | "),
      Motivo: celulaSegura(
        msgs
          .map((m) => m.erro ?? m.aviso ?? "")
          .filter(Boolean)
          .join(" | "),
      ),
      "O que fazer": celulaSegura(
        msgs
          .map((m) => m.correcao ?? "")
          .filter(Boolean)
          .join(" | "),
      ),
      ...bruto,
    };
  });
  const ws = XLSX.utils.json_to_sheet(dados);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Linhas recusadas");
  XLSX.writeFile(wb, nomeArquivo);
}

/** Planilha-modelo com os cabeçalhos oficiais e uma linha de exemplo. */
export async function baixarModelo() {
  const XLSX = await import("xlsx");
  const exemplo: Record<string, string> = {
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
    "Peso (gramas)": "3,5",
    Medidas: "2 mm",
    "Descrição curta": "Anel delicado com cristal central.",
    "Valor de custo": "R$ 12,90",
    "Preço de venda": "R$ 39,90",
    Quantidade: "10",
    "Publicar no site": "não",
  };
  const ws = XLSX.utils.json_to_sheet([exemplo]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Modelo LARDAN");
  XLSX.writeFile(wb, "modelo-importacao-lardan.xlsx");
}

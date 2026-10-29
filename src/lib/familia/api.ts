/* ============================================================
 * FINANCEIRO DA FAMÍLIA — acesso a dados (0177)
 * Só lê/grava tabelas familia_*. A RLS garante que cada login
 * enxerga apenas a própria família (nem Master vê); user_id é
 * preenchido pelo banco (DEFAULT auth.uid()), nunca pelo front.
 * ============================================================ */
import { supabase } from "@/integrations/supabase/client";
import { datasRecorrentes } from "./motor";
import type {
  Categoria, Conta, DespesaFixa, DespesaVariavel, EscopoEdicao, Projeto, Receita,
  RegistroOcorrencia, TipoCategoria,
} from "./tipos";

// O client tipado conhece as tabelas via types.ts; o cast mantém este módulo
// compilando mesmo antes de o Lovable regenerar os tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PAGINA = 1000;

/** Busca todas as linhas paginando (o backend limita 1000 por requisição). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buscarTodos<T>(montar: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar().range(de, de + PAGINA - 1);
    if (error) throw traduzirErro(error);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

/** Mensagens do banco → português claro para o toast. */
export function traduzirErro(e: { message?: string; code?: string } | null | undefined): Error {
  const msg = e?.message ?? "Erro desconhecido";
  if (e?.code === "23505" || /duplicate key/i.test(msg)) return new Error("Já existe um cadastro com esse nome.");
  if (e?.code === "23514" || /check constraint/i.test(msg)) {
    if (/tipo/i.test(msg)) return new Error(msg);
    return new Error("Algum campo está fora do permitido. Confira valores e datas.");
  }
  if (e?.code === "42501" || /row-level security/i.test(msg)) return new Error("Sem permissão para este registro.");
  return new Error(msg);
}

const num = (v: unknown) => (v == null ? v : Number(v));

/* ------------------------------ Cadastros ------------------------------ */

export async function garantirCategoriasPadrao(): Promise<number> {
  const { data, error } = await db.rpc("familia_garantir_categorias_padrao");
  if (error) throw traduzirErro(error);
  return Number(data ?? 0);
}

export async function listarCategorias(): Promise<Categoria[]> {
  return buscarTodos<Categoria>(() =>
    db.from("familia_categorias").select("id, nome, tipo, cor, ordem").order("tipo").order("ordem").order("nome"));
}

export async function salvarCategoria(c: { id?: string; nome: string; tipo: TipoCategoria; cor: string }) {
  const linha = { nome: c.nome.trim(), tipo: c.tipo, cor: c.cor };
  const { error } = c.id
    ? await db.from("familia_categorias").update(linha).eq("id", c.id)
    : await db.from("familia_categorias").insert(linha);
  if (error) throw traduzirErro(error);
}

export async function excluirCategoria(id: string) {
  const { error } = await db.from("familia_categorias").delete().eq("id", id);
  if (error) throw traduzirErro(error);
}

export async function listarContas(): Promise<Conta[]> {
  return buscarTodos<Conta>(() =>
    db.from("familia_contas").select("id, nome, tipo, instituicao, cor, ativa").order("ativa", { ascending: false }).order("nome"));
}

export async function salvarConta(c: Partial<Conta> & { nome: string }) {
  const linha = {
    nome: c.nome.trim(), tipo: c.tipo ?? "conta_corrente",
    instituicao: c.instituicao?.trim() || null, cor: c.cor ?? "#0EA5E9", ativa: c.ativa ?? true,
  };
  const { error } = c.id
    ? await db.from("familia_contas").update(linha).eq("id", c.id)
    : await db.from("familia_contas").insert(linha);
  if (error) throw traduzirErro(error);
}

export async function excluirConta(id: string) {
  const { error } = await db.from("familia_contas").delete().eq("id", id);
  if (error) throw traduzirErro(error);
}

export async function listarProjetos(): Promise<Projeto[]> {
  return buscarTodos<Projeto>(() =>
    db.from("familia_projetos").select("id, nome, cor, ativo").order("ativo", { ascending: false }).order("nome"));
}

export async function salvarProjeto(p: Partial<Projeto> & { nome: string }) {
  const linha = { nome: p.nome.trim(), cor: p.cor ?? "#8B5CF6", ativo: p.ativo ?? true };
  const { error } = p.id
    ? await db.from("familia_projetos").update(linha).eq("id", p.id)
    : await db.from("familia_projetos").insert(linha);
  if (error) throw traduzirErro(error);
}

export async function excluirProjeto(id: string) {
  const { error } = await db.from("familia_projetos").delete().eq("id", id);
  if (error) throw traduzirErro(error);
}

/* ---------------------------- Despesas fixas --------------------------- */

const COLS_FIXA =
  "id, nome, valor, dia_vencimento, mes_inicio, recorrencia, parcelado, parcelas_total, categoria_id, forma_pagamento, projeto_id, conta_id, encerrada_em, observacoes";

export async function listarFixas(): Promise<DespesaFixa[]> {
  const rows = await buscarTodos<DespesaFixa>(() => db.from("familia_despesas_fixas").select(COLS_FIXA).order("nome"));
  return rows.map((r) => ({ ...r, valor: Number(r.valor), parcelas_total: num(r.parcelas_total) as number | null }));
}

export type FixaInput = Omit<DespesaFixa, "id" | "encerrada_em"> & { encerrada_em?: string | null };

export async function salvarFixa(input: FixaInput, id?: string) {
  const linha = {
    ...input,
    nome: input.nome.trim(),
    parcelas_total: input.parcelado ? input.parcelas_total : null,
    observacoes: input.observacoes?.trim() || null,
  };
  const { error } = id
    ? await db.from("familia_despesas_fixas").update(linha).eq("id", id)
    : await db.from("familia_despesas_fixas").insert(linha);
  if (error) throw traduzirErro(error);
}

export async function excluirFixa(id: string) {
  const { error } = await db.from("familia_despesas_fixas").delete().eq("id", id);
  if (error) throw traduzirErro(error);
}

/** Encerra (último mês incluído) ou reativa (null). */
export async function encerrarFixa(id: string, ultimoMes: string | null) {
  const { error } = await db.from("familia_despesas_fixas").update({ encerrada_em: ultimoMes }).eq("id", id);
  if (error) throw traduzirErro(error);
}

export async function reajustarFixa(id: string, novoValor: number, aPartir: string): Promise<string> {
  const { data, error } = await db.rpc("familia_reajustar_fixa", { _id: id, _novo_valor: novoValor, _a_partir: aPartir });
  if (error) throw traduzirErro(error);
  return data as string;
}

export async function listarRegistros(deCompetencia: string, ateCompetencia: string): Promise<RegistroOcorrencia[]> {
  const rows = await buscarTodos<RegistroOcorrencia>(() =>
    db.from("familia_fixas_ocorrencias")
      .select("id, fixa_id, competencia, status, valor_pago, data_pagamento")
      .gte("competencia", deCompetencia)
      .lte("competencia", ateCompetencia)
      .order("competencia"));
  return rows.map((r) => ({ ...r, valor_pago: num(r.valor_pago) as number | null }));
}

export async function marcarFixaPaga(fixaId: string, competencia: string, valorPago: number, dataPagamento: string) {
  const { error } = await db.from("familia_fixas_ocorrencias").upsert(
    { fixa_id: fixaId, competencia, status: "paga", valor_pago: valorPago, data_pagamento: dataPagamento },
    { onConflict: "fixa_id,competencia" },
  );
  if (error) throw traduzirErro(error);
}

export async function pularFixa(fixaId: string, competencia: string) {
  const { error } = await db.from("familia_fixas_ocorrencias").upsert(
    { fixa_id: fixaId, competencia, status: "pulada", valor_pago: null, data_pagamento: null },
    { onConflict: "fixa_id,competencia" },
  );
  if (error) throw traduzirErro(error);
}

/** Volta a ocorrência para "a pagar" (remove a marcação). */
export async function desmarcarFixa(fixaId: string, competencia: string) {
  const { error } = await db.from("familia_fixas_ocorrencias").delete().eq("fixa_id", fixaId).eq("competencia", competencia);
  if (error) throw traduzirErro(error);
}

/* -------------------------- Despesas variáveis ------------------------- */

const COLS_VAR =
  "id, descricao, valor, data, recorrente, grupo_id, ocorrencia_numero, ocorrencias_total, categoria_id, forma_pagamento, projeto_id, conta_id, data_pagamento, observacoes";

export async function listarVariaveis(de: string, ate: string): Promise<DespesaVariavel[]> {
  const rows = await buscarTodos<DespesaVariavel>(() =>
    db.from("familia_despesas_variaveis").select(COLS_VAR).gte("data", de).lte("data", ate).order("data").order("id"));
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
}

export type VariavelInput = Omit<DespesaVariavel, "id" | "recorrente" | "grupo_id" | "ocorrencia_numero" | "ocorrencias_total">;

/** Cria 1 lançamento ou N mensais (mesmo grupo). Data de pagamento só na 1ª. */
export async function criarVariavel(input: VariavelInput, repeticoes = 1): Promise<number> {
  const base = { ...input, descricao: input.descricao.trim(), observacoes: input.observacoes?.trim() || null };
  if (repeticoes <= 1) {
    const { error } = await db.from("familia_despesas_variaveis").insert({ ...base, recorrente: false });
    if (error) throw traduzirErro(error);
    return 1;
  }
  const grupo = crypto.randomUUID();
  const linhas = datasRecorrentes(input.data, repeticoes).map((data, i) => ({
    ...base, data, recorrente: true, grupo_id: grupo, ocorrencia_numero: i + 1, ocorrencias_total: repeticoes,
    data_pagamento: i === 0 ? base.data_pagamento : null,
  }));
  const { error } = await db.from("familia_despesas_variaveis").insert(linhas);
  if (error) throw traduzirErro(error);
  return linhas.length;
}

/**
 * Edita. Escopo "proximas" replica os campos (exceto data e pagamento) para as
 * ocorrências seguintes do mesmo grupo.
 */
export async function atualizarVariavel(atual: DespesaVariavel, patch: Partial<VariavelInput>, escopo: EscopoEdicao) {
  const { data, data_pagamento, ...comuns } = patch;
  const daLinha: Record<string, unknown> = { ...comuns };
  if (data !== undefined) daLinha["data"] = data;
  if (data_pagamento !== undefined) daLinha["data_pagamento"] = data_pagamento;
  if (typeof daLinha["descricao"] === "string") daLinha["descricao"] = (daLinha["descricao"] as string).trim();
  if ("observacoes" in daLinha) daLinha["observacoes"] = (daLinha["observacoes"] as string | null)?.trim() || null;

  const { error } = await db.from("familia_despesas_variaveis").update(daLinha).eq("id", atual.id);
  if (error) throw traduzirErro(error);

  if (escopo === "proximas" && atual.grupo_id && atual.ocorrencia_numero) {
    const replicar = { ...daLinha };
    delete replicar["data"];
    delete replicar["data_pagamento"];
    const { error: e2 } = await db.from("familia_despesas_variaveis").update(replicar)
      .eq("grupo_id", atual.grupo_id).gt("ocorrencia_numero", atual.ocorrencia_numero);
    if (e2) throw traduzirErro(e2);
  }
}

export async function excluirVariavel(atual: DespesaVariavel, escopo: EscopoEdicao) {
  let q = db.from("familia_despesas_variaveis").delete();
  q = escopo === "proximas" && atual.grupo_id && atual.ocorrencia_numero
    ? q.eq("grupo_id", atual.grupo_id).gte("ocorrencia_numero", atual.ocorrencia_numero)
    : q.eq("id", atual.id);
  const { error } = await q;
  if (error) throw traduzirErro(error);
}

export async function marcarVariavelPaga(id: string, dataPagamento: string | null) {
  const { error } = await db.from("familia_despesas_variaveis").update({ data_pagamento: dataPagamento }).eq("id", id);
  if (error) throw traduzirErro(error);
}

/* ------------------------------- Receitas ------------------------------ */

const COLS_REC =
  "id, fonte, valor, data, recorrente, grupo_id, ocorrencia_numero, ocorrencias_total, categoria_id, forma_pagamento, observacoes";

export async function listarReceitas(de: string, ate: string): Promise<Receita[]> {
  const rows = await buscarTodos<Receita>(() =>
    db.from("familia_receitas").select(COLS_REC).gte("data", de).lte("data", ate).order("data").order("id"));
  return rows.map((r) => ({ ...r, valor: Number(r.valor) }));
}

export type ReceitaInput = Omit<Receita, "id" | "recorrente" | "grupo_id" | "ocorrencia_numero" | "ocorrencias_total">;

export async function criarReceita(input: ReceitaInput, repeticoes = 1): Promise<number> {
  const base = { ...input, fonte: input.fonte.trim(), observacoes: input.observacoes?.trim() || null };
  if (repeticoes <= 1) {
    const { error } = await db.from("familia_receitas").insert({ ...base, recorrente: false });
    if (error) throw traduzirErro(error);
    return 1;
  }
  const grupo = crypto.randomUUID();
  const linhas = datasRecorrentes(input.data, repeticoes).map((data, i) => ({
    ...base, data, recorrente: true, grupo_id: grupo, ocorrencia_numero: i + 1, ocorrencias_total: repeticoes,
  }));
  const { error } = await db.from("familia_receitas").insert(linhas);
  if (error) throw traduzirErro(error);
  return linhas.length;
}

export async function atualizarReceita(atual: Receita, patch: Partial<ReceitaInput>, escopo: EscopoEdicao) {
  const { data, ...comuns } = patch;
  const daLinha: Record<string, unknown> = { ...comuns };
  if (data !== undefined) daLinha["data"] = data;
  if (typeof daLinha["fonte"] === "string") daLinha["fonte"] = (daLinha["fonte"] as string).trim();
  if ("observacoes" in daLinha) daLinha["observacoes"] = (daLinha["observacoes"] as string | null)?.trim() || null;

  const { error } = await db.from("familia_receitas").update(daLinha).eq("id", atual.id);
  if (error) throw traduzirErro(error);

  if (escopo === "proximas" && atual.grupo_id && atual.ocorrencia_numero) {
    const replicar = { ...daLinha };
    delete replicar["data"];
    const { error: e2 } = await db.from("familia_receitas").update(replicar)
      .eq("grupo_id", atual.grupo_id).gt("ocorrencia_numero", atual.ocorrencia_numero);
    if (e2) throw traduzirErro(e2);
  }
}

export async function excluirReceita(atual: Receita, escopo: EscopoEdicao) {
  let q = db.from("familia_receitas").delete();
  q = escopo === "proximas" && atual.grupo_id && atual.ocorrencia_numero
    ? q.eq("grupo_id", atual.grupo_id).gte("ocorrencia_numero", atual.ocorrencia_numero)
    : q.eq("id", atual.id);
  const { error } = await q;
  if (error) throw traduzirErro(error);
}

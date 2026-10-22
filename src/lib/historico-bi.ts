/**
 * BI do histórico SmallData (migração 0117). Só leitura, só equipe.
 * Recorte comum: período (emissão da maleta), praça e representante (códigos do SmallData).
 */
import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface RecorteBi {
  de?: string | null;
  ate?: string | null;
  praca?: number | null;
  representante?: number | null;
}
const args = (r: RecorteBi) => ({ _de: r.de ?? null, _ate: r.ate ?? null, _praca: r.praca ?? null, _representante: r.representante ?? null });

export interface KpisBi {
  maletas: number;
  consultoras: number;
  remessas: number;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  valor_vendido_cents: number;
  ticket_medio_cents: number | null;
  ticket_mediano_cents: number | null;
  preco_medio_vendido_cents: number | null;
  maletas_zeradas: number;
  maletas_zeradas_pct: number | null;
  venda_por_consultora_cents: number | null;
  dias_na_rua_mediana: number | null;
  /** maletas do recorte ainda sem acerto: enquanto houver, os valores do período são parciais */
  maletas_sem_acerto: number;
}
export interface FaixaBi {
  ordem: number;
  faixa: string;
  maletas: number;
  giro_pct?: number | null;
  pct?: number;
  valor_vendido_cents?: number;
  pecas_vendidas_media?: number;
  ticket_medio_cents?: number;
}
export interface PainelBi {
  kpis: KpisBi;
  /** mesmo recorte na janela imediatamente anterior, do mesmo tamanho (só com período fechado) */
  anterior: KpisBi | null;
  distribuicao: FaixaBi[];
  pareto: { top10_pct: number | null; top20_pct: number | null; top50_pct: number | null; curva: { consultoras_pct: number; venda_pct: number | null }[] };
  tamanho: FaixaBi[];
  dias_na_rua: FaixaBi[];
  sazonalidade: { mes: number; maletas: number; giro_pct: number | null; ticket_mediano_cents: number | null }[];
  mix: { categoria: string; pecas_enviadas: number; pecas_vendidas: number; envio_pct: number; venda_pct: number | null; giro_pct: number | null; valor_vendido_cents: number }[];
  anos: { ano: number; maletas: number; consultoras: number; giro_pct: number | null; valor_vendido_cents: number; ticket_medio_cents: number | null }[];
}
export type CriterioTop = "valor" | "giro" | "pecas" | "ticket";
export interface ConsultoraTop {
  posicao: number;
  codcli: number;
  party_id: string | null;
  nome: string;
  cidade: string | null;
  uf: string | null;
  praca: number | null;
  praca_nome: string | null;
  maletas: number;
  pecas_enviadas: number;
  pecas_vendidas: number;
  giro_pct: number | null;
  valor_vendido_cents: number;
  ticket_medio_cents: number | null;
  primeira_maleta: string | null;
  ultima_maleta: string | null;
  giro_recente_pct: number | null;
  giro_antes_pct: number | null;
  tendencia: "subindo" | "estavel" | "caindo" | null;
  categoria_mais_vendida: string | null;
}
export interface JornadaBi {
  curva: { n: number; consultoras: number; giro_pct: number | null; venda_media_cents: number | null; voltou_pct: number }[];
  primeira_maleta: { zerada: boolean; consultoras: number; recebeu_segunda_pct: number; giro_segunda_pct: number | null }[];
  trimestres: { trimestre: string; ativas: number; novas: number; pararam: number }[];
  parou_apos: { n: number; consultoras: number }[];
  corte_parou: string | null;
}
interface PessoaAlerta { codcli: number; party_id: string | null; nome: string; cidade?: string | null; praca_nome?: string | null }
export interface AlertasBi {
  hoje: string | null;
  giro_rede_pct: number | null;
  zeraram_duas: { consultoras: number; com_maleta_na_rua: number; pecas_na_rua: number; lista: (PessoaAlerta & { ultima_maleta: string; pecas_na_rua: number })[] };
  em_queda: (PessoaAlerta & { giro_recente_pct: number; giro_antes_pct: number; ultima_maleta: string })[];
  sumiram: (PessoaAlerta & { valor_vendido_cents: number; giro_pct: number | null; ultima_maleta: string; dias_sem_maleta: number })[];
  estreantes: (PessoaAlerta & { giro_pct: number; valor_vendido_cents: number; emissao: string })[];
}
export interface PracaCategoriaBi {
  categorias?: string[];
  giro_rede?: Record<string, number>;
  linhas?: { praca: number; praca_nome: string | null; pecas_enviadas: number;
             celulas: Record<string, { giro_pct: number | null; envio_pct: number | null; indice: number | null }> | null }[];
}
export interface ProdutoBi {
  produto: number;
  nome: string | null;
  referencia: string | null;
  categoria: string | null;
  subcategoria: string | null;
  product_id: string | null;
  quantidade: number;
  valor_cents: number;
  consultoras: number;
  pracas: number;
  ultimos_90d: number;
  anteriores_90d: number;
}
export interface InsightBi {
  chave: string;
  tom: "alerta" | "oportunidade" | "positivo" | "info";
  titulo: string;
  texto: string;
}
export interface OpcoesBi {
  pracas: { codigo: number; nome: string }[];
  representantes: { codigo: number; nome: string }[];
  periodo: { de: string | null; ate: string | null };
}

export const biPainel = (r: RecorteBi) => rpc<PainelBi>("legado_bi_painel", args(r));
export const biTop = (r: RecorteBi, o: { criterio?: CriterioTop; porPraca?: boolean; limite?: number; minMaletas?: number } = {}) =>
  rpc<ConsultoraTop[]>("legado_bi_top", {
    ...args(r), _criterio: o.criterio ?? "valor", _por_praca: o.porPraca ?? false, _limite: o.limite ?? 10, _min_maletas: o.minMaletas ?? 3,
  });
export const biJornada = (r: RecorteBi) => rpc<JornadaBi>("legado_bi_jornada", args(r));
export const biAlertas = (r: Pick<RecorteBi, "praca" | "representante">, limite = 30) =>
  rpc<AlertasBi>("legado_bi_alertas", { _praca: r.praca ?? null, _representante: r.representante ?? null, _limite: limite });
export const biPracaCategoria = (r: Pick<RecorteBi, "de" | "ate" | "representante">) =>
  rpc<PracaCategoriaBi>("legado_bi_praca_categoria", { _de: r.de ?? null, _ate: r.ate ?? null, _representante: r.representante ?? null });
export const biProdutos = (r: RecorteBi, categoria: string | null = null, limite = 20) =>
  rpc<ProdutoBi[]>("legado_bi_produtos", { ...args(r), _categoria: categoria, _limite: limite });
export const biInsights = (r: RecorteBi) => rpc<InsightBi[]>("legado_bi_insights", args(r));
export const biOpcoes = () => rpc<OpcoesBi>("legado_bi_opcoes");

// Revisão dos cadastros criados pelo histórico (0116, só Master)
export interface RevisaoCadastros {
  criadas: number;
  ativas: number;
  deveriam_estar_inativas: number;
  sem_praca: number;
  praca_disponivel: number;
  com_operacao_no_lardan: number;
  possiveis_duplicadas: number;
  duplicadas: { criada: string; codcli: number; display_name: string; outra: string; outra_nome: string; outra_cpf: string | null }[];
}
export const revisaoCadastros = () => rpc<RevisaoCadastros>("legado_cadastros_revisao");
export const ajustarCadastros = (aplicar: boolean) =>
  rpc<{ aplicado: boolean; cadastros_sem_operacao: number; praca_definida: number; inativadas: number }>("legado_cadastros_ajustar", { _aplicar: aplicar });

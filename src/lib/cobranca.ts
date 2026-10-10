import { supabase } from "@/integrations/supabase/client";

export type Etapa = "novo_atraso" | "em_contato" | "em_negociacao" | "promessa" | "acompanhamento";
/** Cada etapa tem um tom fixo (topo da coluna e faixa do card). */
export const ETAPAS: { id: Etapa; rotulo: string; tom: string; faixa: string; fundo: string }[] = [
  { id: "novo_atraso", rotulo: "Novo atraso", tom: "text-danger", faixa: "bg-danger", fundo: "bg-danger/5" },
  { id: "em_contato", rotulo: "Em contato", tom: "text-info", faixa: "bg-info", fundo: "bg-info/5" },
  { id: "em_negociacao", rotulo: "Acordo", tom: "text-warning", faixa: "bg-warning", fundo: "bg-warning/5" },
  { id: "promessa", rotulo: "Promessa de pagamento", tom: "text-success", faixa: "bg-success", fundo: "bg-success/5" },
  { id: "acompanhamento", rotulo: "Judicial", tom: "text-bronze", faixa: "bg-bronze", fundo: "bg-bronze/5" },
];
export const rotuloEtapa = (e: string) => ETAPAS.find((x) => x.id === e)?.rotulo ?? e;

export interface Lembrete { id: string; party_id: string; nome: string; titulo: string; vence_em: string; origem: string }
export const lembretes = () => call<Lembrete[]>("cob_lembretes");
export interface CobConfig { multa_pct: number; juros_mes_pct: number; carencia_dias: number }
export async function cobConfig(): Promise<CobConfig> {
  const { data, error } = await (supabase.from as unknown as (t: string) => { select: (c: string) => { maybeSingle: () => Promise<{ data: CobConfig | null; error: { message: string } | null }> } })("cob_config").select("multa_pct,juros_mes_pct,carencia_dias").maybeSingle();
  if (error) throw new Error(error.message);
  const c = data ?? { multa_pct: 2, juros_mes_pct: 1, carencia_dias: 0 };
  return { multa_pct: Number(c.multa_pct), juros_mes_pct: Number(c.juros_mes_pct), carencia_dias: Number(c.carencia_dias) };
}
export const salvarConfig = (c: CobConfig) => call<void>("cob_config_salvar", { _multa: c.multa_pct, _juros: c.juros_mes_pct, _carencia: c.carencia_dias });
export interface Simulacao {
  id: string; installment_ids: string[]; data_base: string; multa_pct: number; juros_mes_pct: number;
  principal_cents: number; encargos_cents: number; desconto_cents: number; total_cents: number;
  entrada_cents: number; entrada_data: string | null; parcelas: number; primeira_data: string | null;
  plano: { numero: number; data: string; valor_cents: number }[]; observacao: string | null; status: string; created_at: string;
}
export async function simulacoes(party: string): Promise<Simulacao[]> {
  const { data, error } = await (supabase.from as unknown as (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: Simulacao[] | null; error: { message: string } | null }> } } })("cob_simulacoes").select("*").eq("party_id", party).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
export const salvarSimulacao = (party: string, dados: Record<string, unknown>) => call<string>("cob_simulacao_salvar", { _party: party, _dados: dados });
export const statusSimulacao = (id: string, status: "efetivada" | "cancelada", motivo: string) => call<void>("cob_simulacao_status", { _id: id, _status: status, _motivo: motivo });
export async function suspensao(party: string): Promise<{ suspensa: boolean; suspensa_motivo: string | null } | null> {
  const { data, error } = await (supabase.from as unknown as (t: string) => { select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: { suspensa: boolean; suspensa_motivo: string | null } | null; error: { message: string } | null }> } } })("cob_casos").select("suspensa,suspensa_motivo").eq("party_id", party).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
export const suspender = (party: string, suspensa: boolean, motivo: string) => call<void>("cob_suspender", { _party: party, _suspensa: suspensa, _motivo: motivo });
export const ROTULO_SIMULACAO: Record<string, string> = { simulada: "Simulada", aguardando_entrada: "Aguardando entrada", efetivada: "Efetivada", cancelada: "Cancelada" };

export interface Devedor {
  party_id: string; nome: string; documento: string | null; etapa: Etapa;
  responsavel_id: string | null; responsavel_nome: string | null;
  vencido_cents: number; a_vencer_cents: number; parcelas_vencidas: number; maior_atraso: number;
  proxima_acao: string | null; proxima_acao_titulo: string | null;
  promessa_status: string | null; promessa_data: string | null;
  cidade: string | null; uf: string | null; pausa_ate: string | null;
  parcelas_abertas: number; praca_id: string | null; praca_codigo: number | null; praca_nome: string | null;
  representante_id: string | null; representante_nome: string | null; codigo_legado: string | null; tem_fiado: boolean;
}

// RPCs novas ainda podem não constar nos tipos gerados em todos os ambientes
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function carteira(): Promise<Devedor[]> {
  // A API devolve no máximo 1000 linhas por vez: busca a carteira inteira em páginas
  const todas: Devedor[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await (supabase.rpc as unknown as (f: string) => { range: (a: number, b: number) => Promise<{ data: unknown; error: { message: string } | null }> })("cob_carteira2").range(de, de + 999);
    if (error) throw new Error(error.message);
    const pg = (data ?? []) as Devedor[];
    todas.push(...pg);
    if (pg.length < 1000) return todas;
  }
}
export const devedor = (party: string) => call<DevedorFicha>("cob_devedor", { _party: party });
export const registrar = (a: { party: string; tipo: string; resultado?: string | null; obs?: string; parcelas?: string[] }) =>
  call<string>("cob_registrar", { _party: a.party, _tipo: a.tipo, _resultado: a.resultado ?? null, _obs: a.obs ?? null, _parcelas: a.parcelas ?? [] });
export const moverEtapa = (party: string, etapa: Etapa) => call<void>("cob_mover_etapa", { _party: party, _etapa: etapa });
export const criarPromessa = (a: { party: string; valor: number; data: string; parcelas: string[]; obs?: string }) =>
  call<string>("cob_promessa_criar", { _party: a.party, _valor: a.valor, _data: a.data, _parcelas: a.parcelas, _obs: a.obs ?? null });
export const cancelarPromessa = (id: string, motivo: string) => call<void>("cob_promessa_cancelar", { _id: id, _motivo: motivo });
export const criarTarefa = (party: string, titulo: string, vence: string) => call<string>("cob_tarefa_criar", { _party: party, _titulo: titulo, _vence: vence });
export const concluirTarefa = (id: string) => call<void>("cob_tarefa_concluir", { _id: id });

export interface Parcela { installment_id: string; title_id: string; numero: string | null; vencimento: string; saldo_cents: number; valor_cents: number; atraso: number }
export interface Interacao { id: string; tipo: string; resultado: string | null; observacao: string | null; installment_ids: string[]; autor: string | null; created_at: string }
export interface Promessa { id: string; valor_cents: number; data_prometida: string; status: string; installment_ids: string[]; observacao: string | null; cancel_motivo: string | null; created_at: string }
export interface Tarefa { id: string; titulo: string; vence_em: string; status: string; origem: string; motivo_fim: string | null }
export interface DevedorFicha {
  pessoa: { id: string; nome: string; documento: string | null } | null;
  endereco: { cidade: string | null; uf: string | null } | null;
  caso: { etapa: Etapa; responsavel_nome: string | null; pausa_ate: string | null; pausa_motivo: string | null } | null;
  contatos: { tipo: string; valor: string }[];
  parcelas: Parcela[]; interacoes: Interacao[]; promessas: Promessa[]; tarefas: Tarefa[];
  recebimentos: { data: string; valor_cents: number; installment_id: string; estorno: boolean }[];
}

export const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
export const dataBR = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

export const ROTULO_TIPO: Record<string, string> = {
  ligacao: "Ligação", whatsapp_aberto: "WhatsApp aberto (não confirma envio)", negociacao: "Negociação", anotacao: "Anotação",
  desconto_solicitado: "Desconto solicitado (proposta, sem efeito financeiro)", etapa: "Mudança de etapa",
  negativacao_encaminhada: "Negativação encaminhada (manual)", correcao: "Correção",
};
export const ROTULO_PROMESSA: Record<string, string> = {
  vigente: "Vigente", cumprida: "Cumprida", parcial: "Parcialmente cumprida", descumprida: "Descumprida", cancelada: "Cancelada",
};

export interface CockpitFinanceiro {
  resumo: { vencido_cents: number; a_vencer_cents: number; parcelas_abertas: number; maior_atraso: number; recebido_cents: number; comissao_cents: number;
    praca: { codigo: number; nome: string } | null; representante: string | null; codigo_legado: string | null; etapa_cobranca: string | null };
  parcelas: (Parcela & { origem: string | null; descricao: string })[];
  fiado: { linha: number; lote: string; data_cobranca: string | null; vencimento: string; parcela: number; valor_cents: number; situacao_titulo: string | null; title_id: string; importado_em: string }[];
  recebimentos: { data: string; valor_cents: number; estorno: boolean; referencia: string | null; titulo: string | null }[];
  comissoes: { id: string; data: string; indicada: string | null; venda_cents: number; percentual: number; comissao_cents: number; status: string }[];
  maletas: { id: string; ciclo: number; status: string; valor_cents: number | null; pecas: number | null; recebida: string | null; fechada: string | null }[];
  promessas: { valor_cents: number; data: string; status: string }[];
}
export const cockpitFinanceiro = (party: string) => call<CockpitFinanceiro>("consultora_cockpit_financeiro", { _party: party });

export interface KpisCobranca { devedoras: number; vencido_cents: number; hoje: number; atrasadas: number; vencendo: number; descumpridas: number }
export const kpisCobranca = () => call<KpisCobranca>("cob_kpis");

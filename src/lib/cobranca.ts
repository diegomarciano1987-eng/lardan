import { supabase } from "@/integrations/supabase/client";

export type Etapa = "novo_atraso" | "em_contato" | "em_negociacao" | "promessa" | "acompanhamento";
export const ETAPAS: { id: Etapa; rotulo: string }[] = [
  { id: "novo_atraso", rotulo: "Novo atraso" },
  { id: "em_contato", rotulo: "Em contato" },
  { id: "em_negociacao", rotulo: "Em negociação" },
  { id: "promessa", rotulo: "Promessa de pagamento" },
  { id: "acompanhamento", rotulo: "Acompanhamento" },
];
export const rotuloEtapa = (e: string) => ETAPAS.find((x) => x.id === e)?.rotulo ?? e;

export interface Devedor {
  party_id: string; nome: string; documento: string | null; etapa: Etapa;
  responsavel_id: string | null; responsavel_nome: string | null;
  vencido_cents: number; a_vencer_cents: number; parcelas_vencidas: number; maior_atraso: number;
  proxima_acao: string | null; proxima_acao_titulo: string | null;
  promessa_status: string | null; promessa_data: string | null;
  cidade: string | null; uf: string | null; pausa_ate: string | null;
}

// RPCs novas ainda podem não constar nos tipos gerados em todos os ambientes
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const carteira = () => call<Devedor[]>("cob_carteira");
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

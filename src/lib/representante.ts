import { supabase } from "@/integrations/supabase/client";

export type RepResumo = {
  nome: string | null; consultoras: number; ativas: number; devedoras: number;
  aberto_cents: number; vencido_cents: number; hoje_cents: number; parcelas: number; maletas_campo: number;
};
export type RepConsultora = {
  id: string; code: string; display_name: string; status: string; doc_masked: string | null;
  cidade: string | null; whatsapp: string | null; aberto_cents: number; vencido_cents: number;
};
export type RepCobranca = {
  installment_id: string; numero: string | null; vencimento: string; saldo_cents: number;
  party_id: string; display_name: string; code: string;
};
type Pagina<T> = { total: number; itens: T[] };

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const repResumo = (rep: string) => chamar<RepResumo>("rep_portal_resumo", { _rep: rep });
export const repConsultoras = (rep: string, busca: string, filtro: string, pagina: number) =>
  chamar<Pagina<RepConsultora>>("rep_portal_consultoras", { _rep: rep, _busca: busca, _filtro: filtro, _pagina: pagina });
export const repCobrancas = (rep: string, filtro: string, pagina: number, busca = "") =>
  chamar<Pagina<RepCobranca>>("rep_portal_cobrancas", { _rep: rep, _filtro: filtro, _pagina: pagina, _busca: busca || null });

export type RepFicha = {
  id: string; code: string; nome: string; status: string; doc_masked: string | null; rep: string;
  contatos: { kind: string; value: string }[];
  endereco: { rua: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null; referencia: string | null } | null;
  parcelas: RepCobranca[]; aberto_cents: number; vencido_cents: number;
  cheques: { numero: string; valor_cents: number; bom_para: string; status: string }[];
  na_carteira: boolean; rep_nome: string | null; maletas: { status: string; desde: string }[];
  /** Fora da sua carteira: contato, endereço, cheques e maletas ficam ocultos até ela passar para você. */
  restrito?: boolean;
};
export const repFicha = (party: string, rep: string) => chamar<RepFicha>("rep_consultora_ficha_rep", { _party: party, _rep: rep });
export type RepBuscaTodas = {
  id: string; code: string; display_name: string; status: string; cidade: string | null; rep_nome: string | null;
  na_carteira: boolean; pode_assumir: boolean; maletas: number; aberto_cents: number;
};
export const repBuscaTodas = (rep: string, busca: string, pagina: number) =>
  chamar<Pagina<RepBuscaTodas>>("rep_portal_busca_todas", { _rep: rep, _busca: busca, _pagina: pagina });
/** Traz a consultora para a carteira antes de cobrar/reativar (no-op se já é dela). */
export const repAssumir = (party: string, rep: string) => chamar<boolean>("rep_consultora_assumir", { _party: party, _rep: rep });
export const repLeadCriar = (rep: string, f: { nome: string; whatsapp: string; cidade: string; uf: string; nota: string }) =>
  chamar<string>("rep_crm_lead_criar", { _rep: rep, _nome: f.nome, _whatsapp: f.whatsapp, _cidade: f.cidade, _uf: f.uf, _nota: f.nota || null });
export const repEtapaNova = (rep: string, nome: string) => chamar<string>("rep_crm_etapa_nova", { _rep: rep, _nome: nome });

export const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (d: string) => d.split("-").reverse().join("/");

export type RepCrm = {
  codigo: string | null;
  /** sistema: coluna que acompanha a Lardan (aprovada / primeira_maleta / nao_aprovada) — não aceita arrastar. */
  etapas: { id: string; nome: string; sistema: "aprovada" | "primeira_maleta" | "nao_aprovada" | null }[];
  cards: { lead_id: string; protocolo: string; nome: string; whatsapp: string; cidade: string; status_lardan: string; origem: string | null; criado: string; etapa_id: string; nota: string | null; travado: boolean }[];
};
export const repCrm = (rep: string) => chamar<RepCrm>("rep_crm", { _rep: rep });
export const repCrmMover = (lead: string, etapa: string, nota?: string | null) => chamar<null>("rep_crm_mover", { _lead: lead, _etapa: etapa, _nota: nota ?? null });
export const repEtapaSalvar = (id: string | null, nome: string, ordem: number | null) => chamar<string>("rep_crm_etapa_salvar", { _id: id, _nome: nome, _ordem: ordem });
export const repCheque = (payload: Record<string, unknown>) => chamar<string>("rep_cheque_registrar", { _payload: payload });
export const repReativar = (party: string) => chamar<boolean>("rep_consultora_reativar", { _party: party });

// ───────────── 0160 — app do representante ─────────────
export type FaixaCobranca = "vencidas" | "hoje" | "a_vencer" | "1_30" | "31_60" | "61_90" | "90_mais" | "todas";
export type RepCobrancaItem = RepCobranca & {
  atraso: number; divida_cents: number; vencido_cents: number;
  ultimo_contato: { em: string; tipo: string; resultado: string | null; obs: string | null } | null;
  promessa: { valor_cents: number; data: string } | null;
};
export type RepCobrancasLista = { total: number; total_cents: number; faixas: Record<FaixaCobranca, number>; itens: RepCobrancaItem[] };
export const repCobrancasLista = (rep: string, faixa: FaixaCobranca, ordem: "recentes" | "maior", pagina: number, busca = "") =>
  chamar<RepCobrancasLista>("rep_cobrancas_lista", { _rep: rep, _faixa: faixa, _ordem: ordem, _pagina: pagina, _busca: busca || null });

export type TipoContato = "ligacao" | "whatsapp_aberto" | "anotacao" | "negociacao";
export type ResultadoContato = "sucesso" | "sem_sucesso" | "nao_atendeu" | "recado" | "outro";
export const repCobRegistrar = (party: string, tipo: TipoContato, resultado: ResultadoContato | null, obs: string, parcelas: string[]) =>
  chamar<string>("rep_cob_registrar", { _party: party, _tipo: tipo, _resultado: resultado, _obs: obs, _parcelas: parcelas });
export const repCobPromessa = (party: string, valorCents: number, data: string, parcelas: string[], obs: string) =>
  chamar<string>("rep_cob_promessa", { _party: party, _valor: valorCents, _data: data, _parcelas: parcelas, _obs: obs || null });
export type RepHistorico = {
  interacoes: { em: string; tipo: string; resultado: string | null; obs: string | null; autor: string }[];
  promessas: { valor_cents: number; data: string; status: string }[];
};
export const repCobHistorico = (party: string) => chamar<RepHistorico>("rep_cob_historico", { _party: party });

export type ResultadoReativar = { resultado: "reativada" | "pedido_enviado" | "ja_pedido" | "bloqueada" | "ja_ativa"; divida_cents?: number };
export const repReativarPedir = (party: string, motivo: string) => chamar<ResultadoReativar>("rep_consultora_reativar_pedir", { _party: party, _motivo: motivo || null });

/** Cobrança de parte de uma parcela (até o saldo). Valor cheio devolve a própria parcela. */
export const repCobrancaParcial = (installment: string, valorCents: number, chave: string) =>
  chamar<string>("rep_cobranca_parcial", { _installment: installment, _valor_cents: valorCents, _chave: chave });

export type Recibo = {
  numero: number; em: string; valor_cents: number; referente: string | null; consultora: string; code: string | null; doc_masked: string | null;
  representante: string; saldo_restante_cents: number; observacao: string | null; repetido?: boolean;
};
export const repDinheiroReceber = (installment: string, valorCents: number, chave: string, obs: string) =>
  chamar<Recibo>("rep_dinheiro_receber", { _installment: installment, _valor_cents: valorCents, _chave: chave, _obs: obs || null });
export const repRecibos = (rep: string, dias = 30) => chamar<{ total_cents: number; itens: Recibo[] }>("rep_recibos_lista", { _rep: rep, _dias: dias });

export type MaletaCarteira = {
  cycle_id: string; maleta: string; remessa: number | null; party_id: string; consultora: string; status: string;
  acerto: string | null; dias: number | null; vencida: boolean; pecas: number; valor_cents: number;
  pre_baixa: "sem_pre_baixa" | "aberta" | "aguardando_pagamento" | "aguardando_conferencia" | "encerrada" | "pendencia" | "cancelada";
  origem: string | null; installment_id: string | null; saldo_cents: number | null; valor_pagar_cents: number | null;
};
export const repMaletasCarteira = (rep: string) => chamar<MaletaCarteira[]>("rep_maletas_carteira", { _rep: rep });
export const repAcertoCampoDevolucao = (cycle: string, leituras: { variant_id: string; qtd: number }[]) =>
  chamar<{ vendido_cents: number; comissao_pct: number; comissao_cents: number; recebido_lardan_cents?: number; valor_pagar_cents: number }>(
    "rep_acerto_campo_devolucao", { _cycle: cycle, _leituras: leituras });
export const repAcertoFechar = (cycle: string) =>
  chamar<{ installment_id: string | null; valor_pagar_cents: number; repetida?: boolean }>("pre_baixa_fechar", { _cycle: cycle });

export type Visita = {
  id: string; quando: string; motivo: string; status: "agendada" | "realizada" | "nao_encontrada" | "cancelada"; resultado: string | null;
  party_id: string | null; lead_id: string | null; nome: string; atrasada: boolean;
};
export const repAgenda = (rep: string) => chamar<Visita[]>("rep_agenda", { _rep: rep, _de: null, _ate: null });
export const repVisitaAgendar = (rep: string, alvo: { party?: string | null; lead?: string | null }, quando: string, motivo: string) =>
  chamar<string>("rep_visita_agendar", { _rep: rep, _party: alvo.party ?? null, _lead: alvo.lead ?? null, _quando: quando, _motivo: motivo });
export const repVisitaRegistrar = (id: string, status: "realizada" | "nao_encontrada" | "cancelada", resultado: string) =>
  chamar<null>("rep_visita_registrar", { _id: id, _status: status, _resultado: resultado });

/** +5543999990101 → (43) 99999-0101 */
export function foneBR(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v ?? "";
}

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
export const repCobrancas = (rep: string, filtro: string, pagina: number) =>
  chamar<Pagina<RepCobranca>>("rep_portal_cobrancas", { _rep: rep, _filtro: filtro, _pagina: pagina });

export const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (d: string) => d.split("-").reverse().join("/");

export type RepCrm = {
  codigo: string | null;
  etapas: { id: string; nome: string }[];
  cards: { lead_id: string; protocolo: string; nome: string; whatsapp: string; cidade: string; status_lardan: string; origem: string | null; criado: string; etapa_id: string; nota: string | null }[];
};
export const repCrm = (rep: string) => chamar<RepCrm>("rep_crm", { _rep: rep });
export const repCrmMover = (lead: string, etapa: string, nota?: string | null) => chamar<null>("rep_crm_mover", { _lead: lead, _etapa: etapa, _nota: nota ?? null });
export const repEtapaSalvar = (id: string | null, nome: string, ordem: number | null) => chamar<string>("rep_crm_etapa_salvar", { _id: id, _nome: nome, _ordem: ordem });
export const repCheque = (payload: Record<string, unknown>) => chamar<string>("rep_cheque_registrar", { _payload: payload });
export const repReativar = (party: string) => chamar<boolean>("rep_consultora_reativar", { _party: party });

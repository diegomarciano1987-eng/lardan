/**
 * 0332 — app do representante: aberturas aguardando assinatura (lidas do servidor), promissória
 * assinada no papel, dados da promissória A4, 2ª maleta e ficha completa da candidata.
 * Toda regra e permissão vivem no banco; aqui só há chamada.
 */
import { supabase } from "@/integrations/supabase/client";
import type { DocConsultora } from "@/lib/promissoria-html";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface AberturaAssinatura {
  party_id: string; nome: string; telefone: string | null; joined_at: string;
  cycle_id: string; maleta: string; maleta_status: string; abertura_numero: number | null; remessa: number | null;
  contrato: "pendente" | "assinado" | "recusado" | "erro" | null;
  promissoria: "pendente" | "assinado" | "recusado" | "erro" | null;
  promissoria_papel: boolean;
  ultima_assinatura: string | null;
}
export const aberturasAssinatura = (rep: string) =>
  rpc<{ pendentes: AberturaAssinatura[]; concluidas: AberturaAssinatura[] }>("rep_aberturas_assinatura", { _rep: rep });

/** A abertura só termina com contrato assinado e promissória assinada (digital ou no papel). */
export const aberturaConcluida = (a: Pick<AberturaAssinatura, "contrato" | "promissoria" | "promissoria_papel">) =>
  a.contrato === "assinado" && (a.promissoria === "assinado" || a.promissoria_papel);

export const maletaJaTemNaRemessa = (rep: string, cycleId: string, consultora: string) =>
  rpc<{ maleta: string | null }>("rep_maleta_ja_tem", { _rep: rep, _cycle: cycleId, _consultora: consultora });

export const promissoriaPapelRegistrar = (rep: string | null, cycleId: string, obs?: string) =>
  rpc<{ id: string; repetida: boolean; party_id: string }>("promissoria_papel_registrar", { _rep: rep, _cycle: cycleId, _obs: obs ?? null });
export const promissoriaPapelCancelar = (rep: string | null, id: string, motivo: string) =>
  rpc<{ repetida: boolean }>("promissoria_papel_cancelar", { _rep: rep, _id: id, _motivo: motivo });
export const promissoriaDadosImpressao = (rep: string | null, cycleId: string) =>
  rpc<DocConsultora & { valor_cents: number; maleta: string }>("promissoria_dados_impressao", { _rep: rep, _cycle: cycleId });

export interface FichaCandidata {
  nome: string; cpf: string | null; nascimento: string | null; rg: string | null; rg_orgao: string | null; estado_civil: string | null;
  whatsapp: string | null; email: string | null;
  cep: string | null; rua: string | null; numero: string | null; sem_numero: boolean | null; complemento: string | null;
  bairro: string | null; referencia: string | null; cidade: string | null; uf: string | null;
  protocolo: string | null; enviada_em: string | null; indicado_por: string | null;
  respostas: Record<string, string | null>;
  envios: { em: string; respostas: Record<string, unknown> }[];
  perfil_presencial: { em: string | null; resultado: Record<string, unknown> | null } | null;
}
export const fichaCandidata = (lead: string) => rpc<FichaCandidata>("rep_candidata_ficha", { _lead: lead });

/** 0421: maletas repassadas (60 dias) em que a consultora atual ainda não assinou a promissória (celular ou papel). */
export interface PromissoriaPendente {
  cycle_id: string; maleta: string; remessa: number | null; status: string; party_id: string; consultora: string; codigo: string | null;
  telefone: string | null; anterior: string | null; movida_em: string; digital: string | null; sign_url: string | null;
}
export const promissoriasPendentesRep = (rep: string) => rpc<PromissoriaPendente[]>("rep_promissorias_pendentes", { _rep: rep });

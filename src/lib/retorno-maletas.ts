/**
 * 0281 — volta das maletas: expedição de retorno (representante → empresa) e recebimento na Qualidade.
 * Toda regra está no banco (retorno_*); aqui só as chamadas e os rótulos.
 */
import { supabase } from "@/integrations/supabase/client";

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export type MotivoRetorno = "acerto" | "nao_ficou";
export type StatusItemRetorno = "a_caminho" | "recebida" | "nao_veio" | "retirado";
export interface CicloInfo {
  cycle_id: string; maleta: string; remessa: number | null; abertura_numero: number | null;
  consultora: string | null; consultora_codigo: string | null; praca: string | null; status: string;
}
export interface ItemRetorno extends CicloInfo {
  item_id: string; motivo: MotivoRetorno; pecas: number; pecas_recebidas: number | null; status: StatusItemRetorno;
  recebida_em: string | null; ocorrencia: string | null; conferencia: string | null;
}
export interface ExpedicaoRetorno {
  id: string; numero: number; status: "enviada" | "recebida" | "com_falta" | "cancelada"; origem: "representante" | "equipe" | "balcao";
  observacao: string | null; representante_party_id: string | null; representante: string | null;
  enviada_em: string; recebida_em: string | null; itens: ItemRetorno[];
}
export interface ADevolver extends CicloInfo { motivo: MotivoRetorno; pecas: number; desde: string | null; nao_veio: boolean }
export interface PendentesRep {
  a_devolver: ADevolver[]; com_voce: (CicloInfo & { pecas: number })[]; com_consultoras: number; expedicoes: ExpedicaoRetorno[];
}
export interface PainelRetorno {
  pode_receber: boolean; pode_conferir: boolean;
  chegando: ExpedicaoRetorno[];
  conferir: (CicloInfo & { item_id: string; numero: number; representante: string | null; pecas: number; recebida_em: string; conferencia: string })[];
  pendentes: { representante_party_id: string | null; representante: string; quantidade: number; nao_veio: number; maletas: ADevolver[] }[];
  com_representantes: { representante_party_id: string; representante: string; quantidade: number }[];
  recebidas: (CicloInfo & { item_id: string; numero: number; motivo: MotivoRetorno; representante: string | null; pecas: number; recebida_em: string; conferencia: string | null })[];
}
export interface Recebido extends CicloInfo {
  item_id: string; numero: number; motivo: MotivoRetorno; pecas: number; repetida: boolean; precisa_conferir: boolean; expedicao_status?: string;
}

export const pendentesDoRepresentante = (rep: string) => chamar<PendentesRep>("retorno_rep_pendentes", { _rep: rep });
export const expedirRetorno = (rep: string, cycles: string[], obs: string | null, motivoNaoFicou: string | null) =>
  chamar<ExpedicaoRetorno>("retorno_expedir", { _rep: rep, _cycles: cycles, _obs: obs, _motivo_nao_ficou: motivoNaoFicou });
export const retirarDaExpedicao = (item: string, motivo: string) => chamar<{ status: string }>("retorno_item_retirar", { _item: item, _motivo: motivo });
export const painelRetorno = () => chamar<PainelRetorno>("retorno_painel", {});
export const receberMaletaRetorno = (args: { codigo?: string; item?: string }) =>
  chamar<Recebido>("retorno_receber", { _codigo: args.codigo ?? null, _item: args.item ?? null });
export const marcarNaoVeio = (item: string, motivo: string) => chamar<{ expedicao_status: string }>("retorno_nao_veio", { _item: item, _motivo: motivo });

export const ROTULO_MOTIVO: Record<MotivoRetorno, string> = { acerto: "Acerto feito", nao_ficou: "Não ficou com a consultora" };
export const ROTULO_ITEM: Record<StatusItemRetorno, string> = { a_caminho: "A caminho", recebida: "Recebida", nao_veio: "Não veio", retirado: "Tirada da expedição" };

/** "ABERTURA 01 · Remessa 925" para maleta sem consultora; senão o nome dela. */
export function quemEra(c: Pick<CicloInfo, "consultora" | "abertura_numero" | "remessa">): string {
  if (c.consultora) return c.consultora;
  if (c.abertura_numero) return `ABERTURA ${String(c.abertura_numero).padStart(2, "0")}${c.remessa ? ` · Remessa ${c.remessa}` : ""}`;
  return "Sem consultora";
}
export const dataHoraBr = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

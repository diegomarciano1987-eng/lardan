/**
 * 0280 — troca de remessa/representante da maleta pronta e devolução da maleta para a empresa
 * (antes do aceite). Toda regra está no banco; aqui só as chamadas.
 */
import { supabase } from "@/integrations/supabase/client";

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export interface RemessaDestino { id: string; numero: number; praca: string | null; representante: string | null; data_acerto: string | null; status: string }
export interface DevolucaoAberta {
  id: string; cycle_id: string; maleta: string; remessa: number | null; consultora: string | null;
  representante: string | null; motivo: string; origem: "representante" | "equipe"; pedido_em: string; pecas: number;
}

export const remessasDestino = (cycle: string) => chamar<RemessaDestino[]>("remessas_destino_lista", { _cycle: cycle });
export const mudarRemessa = (cycle: string, remessa: string, motivo: string) =>
  chamar<{ remessa: number; custodia_mudou: boolean; abertura_numero: number | null }>("remessa_maleta_mudar_remessa", { _cycle: cycle, _remessa: remessa, _motivo: motivo });
export const pedirDevolucao = (cycle: string, motivo: string) => chamar<{ id: string }>("maleta_devolucao_pedir", { _cycle: cycle, _motivo: motivo });
export const cancelarDevolucao = (id: string, motivo: string) => chamar<{ id: string }>("maleta_devolucao_cancelar", { _id: id, _motivo: motivo });
export const receberDevolucao = (id: string) =>
  chamar<{ pecas: number; pendencia_fiscal: boolean; promissorias_invalidadas: number; repetida?: boolean }>("maleta_devolucao_receber", { _id: id });
export const devolucoesAbertas = (rep: string | null = null) => chamar<DevolucaoAberta[]>("maleta_devolucoes_lista", { _rep: rep });

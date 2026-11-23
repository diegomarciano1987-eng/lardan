import { supabase } from "@/integrations/supabase/client";

/** 0369 — transferência entre contas da empresa a partir do extrato (Mesa + pareamento automático). */
export type ContraLinha = {
  line_id: string; financial_account_id: string; conta: string; data: string; valor_cents: number; historico: string | null; propria: boolean;
};
export type SugestaoTransferencia = {
  propria: boolean; livre: boolean; sentido: "saiu_desta_conta" | "entrou_nesta_conta";
  contas: { id: string; nome: string; kind: string }[];
  contras: ContraLinha[];
};
export type TransferenciaFeita = {
  id: string; origem: "automatico" | "mesa"; modo: "nova" | "existente"; valor_cents: number; motivo: string;
  criado_em: string; desfeito_em: string | null; desfeito_motivo: string | null; data: string;
  conta_origem: string | null; conta_destino: string | null; historico_saida: string | null; historico_entrada: string | null; quem: string | null;
};
export type LinhaAguardando = { id: string; data: string; kind: "entrada" | "saida"; valor_cents: number; historico: string | null; conta: string };
export type ResultadoPareamento = { novas: number; existentes: number; sem_par: number; ambiguas: number; erros: number };

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as unknown as T;
}

export const sugestaoTransferencia = (lineId: string) =>
  chamar<SugestaoTransferencia>("fin_mesa_transferencia_sugestao", { _line_id: lineId });

export const novaTransferenciaDoExtrato = (p: { lineId: string; outraConta: string; contraLineId: string | null; observacao: string }) =>
  chamar<{ id: string; transfer_id: string; repetido: boolean; contra_ligada: boolean }>("fin_mesa_nova_transferencia", {
    _line_id: p.lineId, _outra_conta: p.outraConta, _contra_line_id: p.contraLineId, _observacao: p.observacao.trim() || null,
  });

export const parearTransferenciasAgora = () => chamar<ResultadoPareamento>("fin_transferencias_parear_agora", {});

export const desfazerTransferenciaDoExtrato = (id: string, motivo: string) =>
  chamar<{ ok: boolean }>("fin_transferencia_extrato_desfazer", { _id: id, _motivo: motivo });

export const painelTransferencias = (dias = 60) =>
  chamar<{ feitas: TransferenciaFeita[]; aguardando: LinhaAguardando[] }>("fin_transferencias_extrato_painel", { _dias: dias });

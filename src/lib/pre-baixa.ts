/** 0158 — acerto pelo app (pré-baixa): leitura e ações do banco. */
import { supabase } from "@/integrations/supabase/client";

export type SituacaoPreBaixa = "aberta" | "aguardando_pagamento" | "aguardando_conferencia" | "encerrada" | "pendencia" | "cancelada";
export interface ItemPreBaixa {
  variant_id: string; sku: string | null; barcode: string | null; produto: string; variante: string | null; media_id: string | null;
  enviada: number; app: number; vendida: number; preco_cents: number; lida: number | null; faltando: number; voltou_vendida: number;
  etiqueta_nova: boolean; etiqueta_atualizada: boolean;
}
export interface Calculo { vendido_cents: number; base_faixa_cents: number; comissao_pct: number; comissao_cents: number; valor_pagar_cents: number }
export interface PreBaixa {
  id: string; cycle_id: string; status: string; situacao: SituacaoPreBaixa; prazo: string | null; dias_para_prazo: number | null;
  fechada_em: string | null; encerrada_em: string | null; installment_id: string | null; diferenca_cents: number | null;
  pendencia_motivo: string | null; calculo: Calculo; faixas: { min_cents: number; percentual: number }[]; itens: ItemPreBaixa[];
}
export interface Conferencia {
  pecas_faltando: number; pecas_voltaram_vendidas: number; vendido_declarado_cents: number; vendido_final_cents: number;
  comissao_pct: number; comissao_cents: number; valor_final_cents: number; valor_pre_baixa_cents: number; diferenca_cents: number;
  bateu: boolean; pre_baixa_paga: boolean; aplicado: boolean; status?: string;
  itens: { variant_id: string; enviada: number; vendida: number; lida: number; faltando: number; voltou_vendida: number; preco_cents: number }[];
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export const lerPreBaixa = (cycle: string) => rpc<PreBaixa | null>("pre_baixa_ler", { _cycle: cycle });
export const abrirPreBaixa = (cycle: string) => rpc<string>("pre_baixa_abrir", { _cycle: cycle });
export const venderNaPreBaixa = (cycle: string, variant: string, qtd: number) => rpc<Calculo>("pre_baixa_vender", { _cycle: cycle, _variant: variant, _qtd: qtd });
export const conferirPreBaixa = (cycle: string, leituras: { variant_id: string; qtd: number }[], aplicar: boolean) =>
  rpc<Conferencia>("pre_baixa_conferir", { _cycle: cycle, _leituras: leituras, _aplicar: aplicar });
export const resolverPendencia = (cycle: string, motivo: string) => rpc<null>("pre_baixa_pendencia_resolver", { _cycle: cycle, _motivo: motivo });
export const marcarEtiquetas = (cycle: string, variants: string[]) => rpc<number>("pre_baixa_etiqueta_atualizada", { _cycle: cycle, _variants: variants });
export const liberarKitSemPreBaixa = (consultora: string, motivo: string) => rpc<string>("pre_baixa_liberar_kit", { _consultora: consultora, _motivo: motivo });
export const exigirPreBaixa = (ligar: boolean) => rpc<boolean>("pre_baixa_exigir_definir", { _ligar: ligar });
export const painelPreBaixas = (situacao?: string) =>
  rpc<{ cycle_id: string; maleta: string; consultora: string; remessa: number | null; situacao: SituacaoPreBaixa; prazo: string | null; valor_pagar_cents: number; diferenca_cents: number | null; pendencia: string | null }[]>(
    "pre_baixa_painel", { _situacao: situacao ?? null });
export const indicadoresPreBaixa = () =>
  rpc<{ geral: { conferidos: number; sem_divergencia_pct: number | null; horas_media_pre_baixa_ate_encerrar: number | null; no_prazo_pct: number | null };
    por_consultora: { consultora: string; acertos: number; sem_divergencia_pct: number | null; no_prazo_pct: number | null; horas_media: number | null }[] }>(
    "pre_baixa_indicadores", {});

export const ROTULO_SITUACAO: Record<SituacaoPreBaixa, string> = {
  aberta: "Lançando as vendas",
  aguardando_pagamento: "Pré-baixa fechada · aguardando o Pix",
  aguardando_conferencia: "Pago · aguardando a conferência da maleta",
  encerrada: "Acerto encerrado",
  pendencia: "Acerto com pendência",
  cancelada: "Cancelada",
};

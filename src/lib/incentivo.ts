/** 0182 — Etiqueta "Você pode ganhar" e painel de incentivo da consultora (dados de consultora_incentivo). */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Objetivo } from "@/lib/historico-vendas";

export type Incentivo =
  | { maleta: false }
  | {
      maleta: true;
      cycle_id: string;
      configurado: boolean;
      vendido_cents: number;
      valor_maleta_cents: number;
      kits: number;
      pecas_vendidas: number;
      pecas_total: number;
      acerto: string | null;
      hoje: string;
      faixa: { titulo: string; percentual: number } | null;
      comissao_cents: number;
      proxima: { titulo: string; percentual: number; falta_cents: number; min_cents: number } | null;
      proxima_ganho_extra_cents: number | null;
      comissao_maleta_cents: number;
      percentual_maleta: number;
      objetivo: Objetivo | null;
      objetivo_falta_cents: number | null;
      objetivo_batido: boolean;
    };

export const incentivoQuery = () => queryOptions({
  queryKey: ["consultora", "incentivo"],
  staleTime: 60_000,
  queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_incentivo" as never);
    if (error) throw error;
    return data as unknown as Incentivo;
  },
});

/** Posição (0–100%) de um valor na barra da maleta; null quando passa do valor da maleta. */
export const posicao = (valor: number, total: number) => (total > 0 && valor <= total ? Math.max(0, (valor / total) * 100) : null);

/** Dias entre duas datas "yyyy-MM-dd" (sem fuso). */
export const diasAte = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00`) - Date.parse(`${de}T12:00:00`)) / 864e5);

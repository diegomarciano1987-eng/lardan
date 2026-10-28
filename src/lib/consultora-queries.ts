import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { carregarInicio, listarClientes } from "@/lib/consultora";
import { listarPedidos } from "@/lib/maletas";

export type Liga = { nivel: string | null; proximo: string | null; ciclos: number | null; ciclos_min: number | null; faltam: number; venda_min_cents: number | null };
export type Ganhos = {
  maleta: boolean; configurado: boolean; vendido_cents?: number; valor_maleta_cents?: number; kits?: number;
  pecas_vendidas?: number; pecas_total?: number; acerto?: string | null; hoje?: string;
  faixa?: { titulo: string; percentual: number } | null; comissao_cents?: number; repasse_cents?: number | null;
  proxima?: { titulo: string; percentual: number; falta_cents: number; min_cents: number } | null;
};
export const inicioQuery = () => queryOptions({ queryKey: ["consultora", "inicio"], queryFn: carregarInicio, staleTime: 60_000 });
export const clientesQuery = (busca = "") => queryOptions({ queryKey: ["consultora", "clientes", busca], queryFn: () => listarClientes(busca), staleTime: 60_000 });
export const pedidosQuery = () => queryOptions({ queryKey: ["consultora", "pedidos"], queryFn: () => listarPedidos(), staleTime: 60_000 });
export const ligaQuery = () => queryOptions({ queryKey: ["consultora", "liga"], staleTime: 60_000, retry: false, queryFn: async () => {
  const { data, error } = await supabase.rpc("minha_liga" as never);
  if (error) throw error;
  return data as unknown as Liga;
} });
export const ganhosQuery = () => queryOptions({ queryKey: ["consultora", "ganhos"], staleTime: 60_000, queryFn: async () => {
  const { data, error } = await supabase.rpc("consultora_ganhos" as never);
  if (error) throw error;
  return data as unknown as Ganhos;
} });
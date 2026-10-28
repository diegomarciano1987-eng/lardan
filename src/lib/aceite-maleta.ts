import { supabase } from "@/integrations/supabase/client";
import type { DetalheMaleta } from "@/lib/maletas";

export type PendenciaAceite = { cycle_id: string; codigo: string; situacao: string; remessa: number | null };
export type ConferenciaMaleta = Omit<DetalheMaleta, "composicao"> & {
  remessa_numero: number | null;
  composicao: (DetalheMaleta["composicao"][number] & { referencia: string | null; categoria: string | null })[];
};
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}
export const pendenciasAceite = () => rpc<PendenciaAceite[]>("consultora_aceites_pendentes");
export const conferenciaMaleta = (cycle: string) => rpc<ConferenciaMaleta>("consultora_aceite_dados", { _cycle: cycle });
export function referenciaEtiqueta(variant: string | null, product: string | null) {
  return [variant, product].find((v) => v?.trim() && !/^0+$/.test(v.trim()))?.trim() ?? null;
}
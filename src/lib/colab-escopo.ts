import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ColabEscopo { colaboradora: boolean; representante: string | null; nome: string | null }
export async function lerColabEscopo(): Promise<ColabEscopo> {
  const { data, error } = await supabase.rpc("colab_meu_escopo" as never);
  if (error) throw error;
  return data as unknown as ColabEscopo;
}
export function useColabEscopo() {
  return useQuery({ queryKey: ["colab-escopo"], queryFn: lerColabEscopo });
}
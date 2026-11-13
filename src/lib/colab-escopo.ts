import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** colaboradora = entrou por código (abas de acesso/estoque escondidas).
 *  carteira = presa ao representante vinculado; a gerente da Qualidade (0304, rede_toda) confere toda a rede. */
export interface ColabEscopo { colaboradora: boolean; rede_toda: boolean; carteira: boolean; representante: string | null; nome: string | null }
export async function lerColabEscopo(): Promise<ColabEscopo> {
  const { data, error } = await supabase.rpc("colab_meu_escopo" as never);
  if (error) throw error;
  const d = data as unknown as Omit<ColabEscopo, "carteira" | "rede_toda"> & { rede_toda?: boolean };
  const rede = d.rede_toda === true;
  return { ...d, rede_toda: rede, carteira: d.colaboradora === true && !rede };
}
export function useColabEscopo() {
  return useQuery({ queryKey: ["colab-escopo"], queryFn: lerColabEscopo });
}
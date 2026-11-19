/**
 * 0340 — código da consultora ao lado do nome em toda tela da equipe. Busca em lote (uma consulta por
 * lista), com cache, a partir do cadastro (parties.code) ou da maleta (kit_cycles → consultora).
 * Só leitura; respeita as permissões normais de leitura.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const unicos = (ids: (string | null | undefined)[]) => [...new Set(ids.filter(Boolean) as string[])].sort();

async function codigosPorPessoa(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("parties").select("id, code").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const p of data ?? []) out.set(p.id as string, (p.code as string | null) ?? null);
  }
  return out;
}

/** Map party_id → código. */
export function useCodigosPessoas(ids: (string | null | undefined)[]) {
  const lista = unicos(ids);
  return useQuery({
    queryKey: ["codigos-consultoras", "pessoas", lista],
    enabled: lista.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => codigosPorPessoa(lista),
  });
}

/** Map cycle_id (maleta) → código da consultora da maleta. */
export function useCodigosPorMaleta(cycleIds: (string | null | undefined)[]) {
  const lista = unicos(cycleIds);
  return useQuery({
    queryKey: ["codigos-consultoras", "maletas", lista],
    enabled: lista.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const ciclo = new Map<string, string>();
      for (let i = 0; i < lista.length; i += 200) {
        const { data, error } = await supabase.from("kit_cycles").select("id, consultora_party_id").in("id", lista.slice(i, i + 200));
        if (error) throw error;
        for (const c of data ?? []) if (c.consultora_party_id) ciclo.set(c.id as string, c.consultora_party_id as string);
      }
      const codigos = await codigosPorPessoa(unicos([...ciclo.values()]));
      const out = new Map<string, string | null>();
      for (const [cid, pid] of ciclo) out.set(cid, codigos.get(pid) ?? null);
      return out;
    },
  });
}

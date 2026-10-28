import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/maletas";

export function AvisoProximaMaleta() {
  const q = useQuery({ queryKey: ["consultora", "aviso-proxima-maleta"], queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_aviso_proxima_maleta");
    if (error) throw error;
    return data as { texto: string; minimo_cents: number | null };
  } });
  if (!q.data?.texto?.trim() || !q.data.minimo_cents) return null;
  return <aside aria-label="Venda mínima para a próxima maleta" className="mb-5 flex flex-wrap items-center justify-between gap-4 border-y border-primary/30 bg-primary/10 px-4 py-4 text-foreground">
    <p className="min-w-0 flex-1 text-lg font-semibold leading-relaxed">{q.data.texto}</p>
    <strong className="shrink-0 text-3xl tabular-nums">{brl(q.data.minimo_cents)}</strong>
  </aside>;
}
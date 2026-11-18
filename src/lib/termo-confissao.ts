import { supabase } from "@/integrations/supabase/client";
import type { SituacaoTermo } from "@/lib/cobranca-historica";

type Rpc = (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: Rpc = (f, a) => (supabase.rpc as unknown as Rpc).call(supabase, f, a);

/** Situação do termo de confissão (ZapSign) por acordo. Só leitura, trava de cobrança no banco. */
export async function termosConfissao(sims: string[]): Promise<Map<string, SituacaoTermo>> {
  if (!sims.length) return new Map();
  const { data, error } = await rpc("cob_termos_confissao", { _sims: sims.slice(0, 2000) });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as (SituacaoTermo & { simulacao_id: string })[]).map((t) => [t.simulacao_id, t]));
}

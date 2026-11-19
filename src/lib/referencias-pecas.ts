/**
 * 0341 — regra: toda peça aparece com a referência (ex.: LAN0353) junto do nome, em qualquer tela.
 * Busca em lote (uma consulta por lista), com cache, via pecas_referencias (só a referência, já pública).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SEM_REFERENCIA = "Sem referência";

/** "LAN0353 · Anel Gota" — referência sempre na frente do nome. */
export function comReferencia(referencia: string | null | undefined, nome: string | null | undefined): string {
  const r = (referencia ?? "").trim();
  const n = (nome ?? "").trim();
  if (!r) return n ? `${SEM_REFERENCIA} · ${n}` : SEM_REFERENCIA;
  if (!n || n.toUpperCase().startsWith(r.toUpperCase())) return n || r;
  return `${r} · ${n}`;
}

export async function buscarReferencias(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 1000) {
    const { data, error } = await supabase.rpc("pecas_referencias" as never, { _ids: ids.slice(i, i + 1000) } as never);
    if (error) throw error;
    for (const r of (data ?? []) as { variant_id: string; referencia: string | null }[]) out.set(r.variant_id, r.referencia);
  }
  return out;
}

/** Map variant_id → referência para uma lista de peças. */
export function useReferencias(variantIds: (string | null | undefined)[]) {
  const lista = [...new Set(variantIds.filter(Boolean) as string[])].sort();
  return useQuery({
    queryKey: ["referencias-pecas", lista],
    enabled: lista.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => buscarReferencias(lista),
  });
}

/* Lote automático: várias linhas pedem a referência no mesmo instante → uma única consulta. */
let fila = new Map<string, { ok: (r: string | null) => void; erro: (e: unknown) => void }[]>();
let agendado = false;
function carregarReferencia(id: string): Promise<string | null> {
  return new Promise((ok, erro) => {
    const lista = fila.get(id) ?? [];
    lista.push({ ok, erro });
    fila.set(id, lista);
    if (agendado) return;
    agendado = true;
    setTimeout(() => {
      const atual = fila;
      fila = new Map();
      agendado = false;
      buscarReferencias([...atual.keys()])
        .then((m) => { for (const [k, rs] of atual) for (const r of rs) r.ok(m.get(k) ?? null); })
        .catch((e) => { for (const rs of atual.values()) for (const r of rs) r.erro(e); });
    }, 15);
  });
}

/** Referência de uma peça (agrupa com as outras linhas da tela numa só consulta). */
export function useReferencia(variantId: string | null | undefined) {
  return useQuery({
    queryKey: ["referencia-peca", variantId],
    enabled: !!variantId,
    staleTime: 30 * 60_000,
    queryFn: () => carregarReferencia(variantId!),
  });
}

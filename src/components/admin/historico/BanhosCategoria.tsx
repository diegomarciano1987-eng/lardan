/**
 * 0315 — o que ela mais vende por banho dentro de cada categoria (dourado, prata, aço, ródio…), em %.
 * Base: peças vendidas no SmallData + acertos do Lardan (consultora_banhos_categoria). Só leitura.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BanhoPct { banho: string; qtd: number; pct: number }
export interface BanhosCategoriaDados { total: number; categorias: { categoria: string; total: number; banhos: BanhoPct[] }[] }

export const ROTULO_BANHO: Record<string, string> = {
  dourado: "Dourado", prata_banhada: "Prata", prata_925: "Prata 925", rodio_branco: "Ródio", aco_inox: "Aço", sem_banho: "sem banho informado",
};
/** Mesma categoria escrita de jeitos diferentes (PULSEIRAS × Pulseira, acento) casa pela chave. */
export const chaveCategoria = (c: string) =>
  c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().replace(/S$/, "");

export function useBanhos(partyId: string | null | undefined) {
  return useQuery({
    queryKey: ["historico", "banhos", partyId],
    enabled: Boolean(partyId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_banhos_categoria" as never, { _party: partyId } as never);
      if (error) throw error;
      const d = data as unknown as BanhosCategoriaDados;
      const m = new Map<string, BanhoPct[]>();
      for (const c of d.categorias ?? []) {
        const k = chaveCategoria(c.categoria);
        const antes = m.get(k);
        if (!antes) { m.set(k, c.banhos); continue; }
        // soma as duas grafias e recalcula a %
        const soma = new Map<string, number>();
        for (const b of [...antes, ...c.banhos]) soma.set(b.banho, (soma.get(b.banho) ?? 0) + b.qtd);
        const tot = [...soma.values()].reduce((a, b) => a + b, 0) || 1;
        m.set(k, [...soma].map(([banho, qtd]) => ({ banho, qtd, pct: Math.round((qtd * 100) / tot) })).sort((a, b) => (a.banho === "sem_banho" ? 1 : 0) - (b.banho === "sem_banho" ? 1 : 0) || b.qtd - a.qtd));
      }
      return { ...d, porCategoria: m };
    },
  });
}

/** "Dourado 42% · Prata 50% · sem banho informado 8%" */
export function textoBanhos(banhos?: BanhoPct[] | null) {
  if (!banhos?.length) return null;
  return banhos.map((b) => `${ROTULO_BANHO[b.banho] ?? b.banho} ${b.pct}%`).join(" · ");
}

export function LinhaBanhos({ banhos, className }: { banhos?: BanhoPct[] | null | undefined; className?: string }) {
  const t = textoBanhos(banhos);
  if (!t) return null;
  return <p className={className ?? "mt-1 text-xs text-ledger-muted"}><span className="font-semibold">Banho:</span> {t}</p>;
}

/** Quadro completo (todas as categorias), para onde não há o gráfico de categorias. */
export function QuadroBanhos({ partyId, titulo }: { partyId: string; titulo?: string }) {
  const q = useBanhos(partyId);
  if (q.isLoading) return <p className="text-sm text-ledger-muted">Carregando banhos…</p>;
  if (q.isError) return <p className="text-sm text-danger">Não foi possível ler os banhos: {(q.error as Error).message}</p>;
  const cats = q.data?.categorias ?? [];
  if (!cats.length) return <p className="text-sm text-ledger-muted">Sem dados de vendas.</p>;
  return (
    <div className="space-y-2">
      {titulo && <p className="text-sm font-semibold">{titulo}</p>}
      <ul className="space-y-1.5 text-sm">
        {cats.map((c) => (
          <li key={c.categoria} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-1.5 last:border-0">
            <span className="font-medium">{c.categoria} <span className="text-xs font-normal text-ledger-muted">({c.total} vendidas)</span></span>
            <span className="tabular-nums text-ledger-muted">{textoBanhos(c.banhos)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

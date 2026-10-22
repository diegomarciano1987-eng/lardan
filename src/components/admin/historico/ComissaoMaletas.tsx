import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { comissaoPorRemessa, faixasComissao } from "@/lib/comissao-maletas";

type Maleta = { remessa: number; kit: number; tipo: string; emissao: string | null; fechamento: string | null; pecas_vendidas: number | null; valor_vendido_cents: number | null };
const brl = formatBRLFromCents;
const data = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

/** Aba "Comissão por maletas": maletas do histórico calculadas pelas faixas do Daniel. */
export function ComissaoMaletas({ maletas }: { maletas: Maleta[] }) {
  const q = useQuery({ queryKey: ["comissao-faixas-leitura"], queryFn: faixasComissao });
  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const faixas = q.data ?? [];
  if (faixas.length === 0) return <EmptyState title="Comissão ainda não configurada" description="Cadastre as faixas em Candidatura, indicação e comissão → Configurações de comissão." />;

  const grupos = comissaoPorRemessa(maletas, faixas);
  const acertadas = grupos.filter((g) => g.comissao_cents != null);
  const totCom = acertadas.reduce((x, g) => x + (g.comissao_cents ?? 0), 0);
  const totVend = acertadas.reduce((x, g) => x + (g.vendido_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Comissão total", brl(totCom)], ["Vendido com acerto", brl(totVend)], ["Percentual médio", totVend ? `${((totCom / totVend) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"], ["Remessas com comissão", String(acertadas.length)]].map(([r, v]) => (
          <div key={r} className="rounded-xl border border-line-soft bg-surface p-4"><p className="ledger-eyebrow">{r}</p><p className="mt-1 font-display text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Panel title="Faixas vigentes">
        <div className="flex flex-wrap gap-2 text-sm">
          {faixas.map((f) => <span key={f.min_cents} className="rounded-lg border border-line-soft px-3 py-1.5"><strong>{f.titulo || "Faixa"}</strong> · a partir de {brl(f.min_cents)} · {f.percentual.toLocaleString("pt-BR")}%</span>)}
        </div>
        <p className="mt-3 text-xs text-ledger-muted">Estimativa pela tabela atual. Kits da mesma remessa são somados: a faixa vale sobre o total da remessa. O acerto oficial continua no financeiro.</p>
      </Panel>
      <Panel title="Comissão por remessa (kits somados)" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr><th className="px-6 py-3">Remessa</th><th className="px-6 py-3">Kit</th><th className="px-6 py-3">Emissão</th><th className="px-6 py-3">Acerto</th><th className="px-6 py-3 text-right">Vendido</th><th className="px-6 py-3">Faixa</th><th className="px-6 py-3 text-right">Comissão</th><th className="px-6 py-3 text-right">Repasse LARDAN</th></tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={g.remessa}>
                  <tr key={`r-${g.remessa}`} className="border-b border-line-soft bg-surface-muted/40">
                    <td className="px-6 py-3 font-semibold">{g.remessa}</td>
                    <td className="px-6 py-3">{g.kits.length > 1 ? `${g.kits.length} kits` : g.kits[0].kit}</td>
                    <td className="px-6 py-3">{data(g.kits.map((k) => k.emissao ?? "").sort()[0] || null)}</td>
                    <td className="px-6 py-3">{data(g.acerto)}{g.parcial ? " (parcial)" : ""}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-semibold">{g.vendido_cents != null ? brl(g.vendido_cents) : "sem acerto"}</td>
                    <td className="px-6 py-3">{g.vendido_cents != null ? (g.faixa ? `${g.faixa.titulo || "Faixa"} (${g.faixa.percentual.toLocaleString("pt-BR")}%)` : "Abaixo da 1ª faixa") : "—"}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-semibold">{g.comissao_cents != null ? brl(g.comissao_cents) : "—"}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{g.repasse_cents != null ? brl(g.repasse_cents) : "—"}</td>
                  </tr>
                  {g.kits.length > 1 && g.kits.map((k) => (
                    <tr key={`k-${g.remessa}-${k.kit}`} className="border-b border-line-soft text-ledger-muted last:border-0">
                      <td className="px-6 py-2" /><td className="px-6 py-2">Kit {k.kit}</td>
                      <td className="px-6 py-2">{data(k.emissao)}</td><td className="px-6 py-2">{data(k.fechamento)}</td>
                      <td className="px-6 py-2 text-right tabular-nums">{k.fechamento && k.valor_vendido_cents != null ? brl(k.valor_vendido_cents) : "sem acerto"}</td>
                      <td className="px-6 py-2">faixa da remessa</td>
                      <td className="px-6 py-2 text-right tabular-nums">{g.kitComissao(k) != null ? brl(g.kitComissao(k)!) : "—"}</td>
                      <td className="px-6 py-2" />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

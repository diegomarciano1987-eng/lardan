import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { comissaoMaleta, faixasComissao } from "@/lib/comissao-maletas";

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

  const linhas = maletas.filter((m) => m.tipo !== "perdida").map((m) => ({ m, c: comissaoMaleta(m.fechamento ? m.valor_vendido_cents : null, faixas) }));
  const acertadas = linhas.filter((l) => l.c);
  const totCom = acertadas.reduce((s, l) => s + l.c!.comissao_cents, 0);
  const totVend = acertadas.reduce((s, l) => s + (l.m.valor_vendido_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Comissão total", brl(totCom)], ["Vendido com acerto", brl(totVend)], ["Percentual médio", totVend ? `${((totCom / totVend) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"], ["Maletas com comissão", String(acertadas.length)]].map(([r, v]) => (
          <div key={r} className="rounded-xl border border-line-soft bg-surface p-4"><p className="ledger-eyebrow">{r}</p><p className="mt-1 font-display text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <Panel title="Faixas vigentes">
        <div className="flex flex-wrap gap-2 text-sm">
          {faixas.map((f) => <span key={f.min_cents} className="rounded-lg border border-line-soft px-3 py-1.5"><strong>{f.titulo || "Faixa"}</strong> · a partir de {brl(f.min_cents)} · {f.percentual.toLocaleString("pt-BR")}%</span>)}
        </div>
        <p className="mt-3 text-xs text-ledger-muted">Estimativa pela tabela atual. O acerto oficial continua no financeiro.</p>
      </Panel>
      <Panel title="Comissão de cada maleta" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr><th className="px-6 py-3">Remessa</th><th className="px-6 py-3">Kit</th><th className="px-6 py-3">Emissão</th><th className="px-6 py-3">Acerto</th><th className="px-6 py-3 text-right">Vendido</th><th className="px-6 py-3">Faixa</th><th className="px-6 py-3 text-right">Comissão</th><th className="px-6 py-3 text-right">Repasse LARDAN</th></tr>
            </thead>
            <tbody>
              {linhas.map(({ m, c }, i) => (
                <tr key={`${m.remessa}-${m.kit}-${i}`} className="border-b border-line-soft last:border-0">
                  <td className="px-6 py-3 font-semibold">{m.remessa}</td><td className="px-6 py-3">{m.kit}</td>
                  <td className="px-6 py-3">{data(m.emissao)}</td><td className="px-6 py-3">{data(m.fechamento)}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{c ? brl(m.valor_vendido_cents ?? 0) : "sem acerto"}</td>
                  <td className="px-6 py-3">{c ? (c.faixa ? `${c.faixa.titulo || "Faixa"} (${c.faixa.percentual.toLocaleString("pt-BR")}%)` : "Abaixo da 1ª faixa") : "—"}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold">{c ? brl(c.comissao_cents) : "—"}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{c ? brl(c.repasse_cents) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

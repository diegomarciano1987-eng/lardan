/**
 * Inteligência da rede sobre o histórico JFLEX: ranking por agrupamento e
 * evolução mensal. Somente leitura.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateRangeField } from "@/components/premium/DateRangeField";
import type { DateRange } from "react-day-picker";
import { rankingRede, redeMensal, type AgrupamentoRede, type LinhaRanking } from "@/lib/historico-jflex";
import { isoDia } from "@/lib/remessas";

const brl = formatBRLFromCents;
const data = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

const AGRUPAMENTOS: { value: AgrupamentoRede; label: string }[] = [
  { value: "praca", label: "Praça" },
  { value: "representante", label: "Representante" },
  { value: "cidade", label: "Cidade" },
  { value: "uf", label: "UF" },
  { value: "consultora", label: "Consultora" },
  { value: "categoria", label: "Categoria" },
];

export function RedeHistorico() {
  const [agrupar, setAgrupar] = React.useState<AgrupamentoRede>("praca");
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>();
  const [praca, setPraca] = React.useState("");
  const [categoria, setCategoria] = React.useState("");

  const de = isoDia(periodo?.from);
  const ate = isoDia(periodo?.to ?? periodo?.from);

  const ranking = useQuery({
    queryKey: ["historico-jflex", "ranking", agrupar, de, ate, praca, categoria],
    queryFn: () => rankingRede(agrupar, { de, ate, praca: praca ? Number(praca) : null, categoria: categoria || null, limite: 50 }),
  });
  const mensal = useQuery({
    queryKey: ["historico-jflex", "mensal", de, ate, praca],
    queryFn: () => redeMensal({ de, ate, praca: praca ? Number(praca) : null }),
  });

  const pracas = useQuery({
    queryKey: ["historico-jflex", "opcoes-pracas"],
    queryFn: () => rankingRede("praca", { limite: 200 }),
    staleTime: 1000 * 60 * 10,
  });
  const categorias = useQuery({
    queryKey: ["historico-jflex", "opcoes-categorias"],
    queryFn: () => rankingRede("categoria", { limite: 200 }),
    staleTime: 1000 * 60 * 10,
  });

  const linhas: LinhaRanking[] = ranking.data ?? [];
  const maxValor = Math.max(...linhas.map((l) => l.valor_vendido_cents), 1);
  const meses = mensal.data ?? [];
  const maxMes = Math.max(...meses.map((m) => m.valor_vendido_cents ?? 0), 1);

  return (
    <div className="space-y-5">
      <Panel title="Filtros do histórico JFLEX">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Agrupar por</span>
            <SmartSelect value={agrupar} onChange={(v) => setAgrupar(v as AgrupamentoRede)} options={AGRUPAMENTOS} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Período</span>
            <DateRangeField value={periodo} onChange={setPeriodo} placeholder="Todo o histórico" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Praça</span>
            <SmartSelect value={praca} onChange={setPraca}
              options={[{ value: "", label: "Todas as praças" }, ...(pracas.data ?? []).map((p) => ({ value: p.chave, label: p.nome ?? `Praça ${p.chave}` }))]}
              placeholder="Todas as praças" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Categoria</span>
            <SmartSelect value={categoria} onChange={setCategoria}
              options={[{ value: "", label: "Todas as categorias" }, ...(categorias.data ?? []).map((c) => ({ value: c.chave, label: c.nome ?? c.chave }))]}
              placeholder="Todas as categorias" />
          </label>
        </div>
      </Panel>

      <Panel title={`Ranking por ${AGRUPAMENTOS.find((a) => a.value === agrupar)?.label.toLowerCase()}`} flush>
        {ranking.isLoading && <div className="space-y-2 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {ranking.isError && <div className="px-6 py-4"><ErrorState message={(ranking.error as Error).message} onRetry={() => void ranking.refetch()} /></div>}
        {!ranking.isLoading && !ranking.isError && linhas.length === 0 && (
          <div className="px-6 py-5"><EmptyState title="Nenhum dado no histórico com estes filtros" description="Os números aparecem depois da importação do JFLEX." /></div>
        )}
        {linhas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                <tr>
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3 text-right">Maletas</th>
                  <th className="px-6 py-3 text-right">Consultoras</th>
                  <th className="px-6 py-3 text-right">Enviadas</th>
                  <th className="px-6 py-3 text-right">Vendidas</th>
                  <th className="px-6 py-3 text-right">Giro</th>
                  <th className="px-6 py-3 text-right">Valor vendido</th>
                  <th className="px-6 py-3 text-right">Ticket médio</th>
                  <th className="px-6 py-3">Última maleta</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.chave} className="border-b border-line-soft last:border-0">
                    <td className="px-6 py-3 font-medium text-ledger-text">
                      {l.party_id ? (
                        <Link to="/admin/cadastros/pessoas/$id" params={{ id: l.party_id }} className="admin-link">{l.nome ?? l.chave}</Link>
                      ) : (
                        (l.nome ?? l.chave)
                      )}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.maletas}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.consultoras}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.pecas_enviadas}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.pecas_vendidas}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.giro_pct != null ? `${l.giro_pct}%` : "—"}</td>
                    <td className="px-6 py-3 text-right tabular-nums font-semibold">{brl(l.valor_vendido_cents)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{l.ticket_medio_maleta_cents ? brl(l.ticket_medio_maleta_cents) : "—"}</td>
                    <td className="px-6 py-3 text-ledger-muted">{data(l.ultima_maleta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Valor vendido por mês">
        {mensal.isLoading && <Skeleton className="h-40 w-full" />}
        {mensal.isError && <ErrorState message={(mensal.error as Error).message} onRetry={() => void mensal.refetch()} />}
        {meses.length === 0 && !mensal.isLoading && !mensal.isError && <p className="text-sm text-ledger-muted">Sem dados.</p>}
        {meses.length > 0 && (
          <div className="space-y-2">
            {meses.map((m) => (
              <div key={m.mes} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs tabular-nums text-ledger-muted">{m.mes}</span>
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full rounded-full bg-bronze" style={{ width: `${Math.round(((m.valor_vendido_cents ?? 0) / maxMes) * 100)}%` }} />
                </div>
                <span className="w-56 shrink-0 text-right text-xs tabular-nums text-ledger-muted">
                  {brl(m.valor_vendido_cents ?? 0)} · giro {m.giro_pct ?? "—"}%
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import { listarParcelas } from "@/lib/financeiro-parcelas";
import { listarRepresentantesFiltro, opcoesRepresentante } from "@/lib/financeiro";

const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const mesBR = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

/** Uma linha por parcela: vencimento, saldo e competência próprios; total do contrato só como referência. */
export function ListaParcelas({ direction }: { direction: "payable" | "receivable" }) {
  const periodo = usePeriodoFinanceiro();
  const [busca, setBusca] = React.useState("");
  const [situacao, setSituacao] = React.useState("todos");
  const [pagina, setPagina] = React.useState(0);
  const [rep, setRep] = React.useState("");
  const reps = useQuery({ queryKey: ["fin-rep-filtro"], queryFn: listarRepresentantesFiltro, enabled: direction === "receivable", staleTime: 60_000 });
  const POR = 50;
  const q = useQuery({
    queryKey: ["fin-parcelas", direction, periodo.de, periodo.ate, busca, situacao, pagina, rep],
    queryFn: () =>
      listarParcelas({
        direction,
        de: periodo.de,
        ate: periodo.ate,
        busca,
        situacao,
        limit: POR,
        offset: pagina * POR,
        ...(rep ? { rep } : {}),
      }),
  });
  const d = q.data;
  return (
    <Panel title="Parcelas do período" flush>
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(0);
          }}
          placeholder="Buscar por descrição, número ou pessoa"
          className="h-10 w-72 rounded-[10px] border border-line bg-surface px-3 text-sm"
          aria-label="Buscar parcelas"
        />
        <SmartSelect
          options={[
            { value: "todos", label: "Todas as parcelas" },
            { value: "aberto", label: "Em aberto" },
            { value: "vencido", label: "Vencidas" },
            { value: "quitado", label: "Quitadas" },
          ]}
          value={situacao}
          onChange={(v) => {
            setSituacao(v);
            setPagina(0);
          }}
          className="w-52"
        />
        {direction === "receivable" && (
          <SmartSelect options={opcoesRepresentante(reps.data)} value={rep} onChange={(v) => { setRep(v); setPagina(0); }} className="w-72" />
        )}
        {d ? (
          <p className="text-sm font-medium text-ledger-text">
            {d.total} parcela(s) · valor {formatBRLFromCents(d.valor_parcelas_cents)} · saldo{" "}
            <strong className="tabular-nums">{formatBRLFromCents(d.saldo_cents)}</strong>
          </p>
        ) : null}
      </div>
      {d ? <p className="px-5 pt-2 text-xs text-ledger-muted">{d.criterio}</p> : null}
      {q.isLoading ? <Skeleton className="m-5 h-40" /> : null}
      {q.error ? <ErrorState message="Não foi possível carregar as parcelas." /> : null}
      {d ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-line-soft bg-cream-2 text-left text-xs text-ledger-muted">
                <th className="px-5 py-2">Vencimento</th>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Parcela</th>
                <th className="px-3 py-2">Competência</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-5 py-2 text-right">Total do contrato</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-b border-line-soft/60">
                  <td className="px-5 py-2 tabular-nums">{dataBR(r.vencimento)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-ledger-text">{r.descricao}</p>
                    <p className="text-xs text-ledger-muted">
                      {r.contraparte}
                      {r.natureza && !["receita", "deducao", "custo", "despesa"].includes(r.natureza)
                        ? " · fora da DRE"
                        : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.numero}/{r.total_parcelas}
                  </td>
                  <td className="px-3 py-2">
                    {mesBR(r.competencia)}
                    {r.competencia_propria ? null : (
                      <span className="block text-xs text-ledger-muted">do título</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRLFromCents(r.valor_cents)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {formatBRLFromCents(r.saldo_cents)}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-ledger-muted">
                    {formatBRLFromCents(r.total_contrato_cents)}
                  </td>
                </tr>
              ))}
              {d.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-ledger-muted">
                    Sem parcelas no período.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {d.total > POR ? (
            <div className="flex items-center justify-end gap-3 px-5 py-3">
              <button type="button" className="admin-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </button>
              <span className="text-sm">
                {pagina + 1} de {Math.ceil(d.total / POR)}
              </span>
              <button
                type="button"
                className="admin-btn"
                disabled={(pagina + 1) * POR >= d.total}
                onClick={() => setPagina(pagina + 1)}
              >
                Próxima
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

/** Alterna entre a lista por título e a lista por parcela. */
export function AlternarVisao({
  visao,
  onChange,
}: {
  visao: "titulo" | "parcela";
  onChange: (v: "titulo" | "parcela") => void;
}) {
  return (
    <div role="tablist" aria-label="Visão da lista" className="mb-4 inline-flex rounded-[12px] border border-line bg-surface p-1">
      {(
        [
          ["titulo", "Por título"],
          ["parcela", "Por parcela"],
        ] as const
      ).map(([v, rot]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={visao === v}
          onClick={() => onChange(v)}
          className={`h-9 rounded-[9px] px-4 text-sm font-medium ${visao === v ? "bg-ledger-text text-surface" : "text-ledger-text"}`}
        >
          {rot}
        </button>
      ))}
    </div>
  );
}

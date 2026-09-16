import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Panel, Skeleton, formatDateTime } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { listFinAudit } from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro/auditoria")({
  component: Auditoria,
});

const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25";

function Auditoria() {
  const [de, setDe] = React.useState("");
  const [ate, setAte] = React.useState("");
  const [acao, setAcao] = React.useState("");
  const [busca, setBusca] = React.useState("");

  const q = useQuery({
    queryKey: ["fin-audit", de, ate, acao, busca],
    queryFn: () =>
      listFinAudit({
        ...(de ? { de } : {}),
        ...(ate ? { ate } : {}),
        ...(acao ? { acao } : {}),
        ...(busca ? { busca } : {}),
        limit: 200,
        offset: 0,
      }),
  });

  return (
    <AreaFinanceiraGuard capacidade="finance.audit.view">
      <Panel title="Auditoria financeira">
        <p className="mb-4 text-sm font-medium text-ledger-muted">
          Histórico gravado pelo servidor. Não pode ser editado nem apagado.
        </p>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            type="date"
            value={de}
            onChange={(e) => setDe(e.target.value)}
            className={`${inputCls} w-44`}
          />
          <input
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            className={`${inputCls} w-44`}
          />
          <SmartSelect
            options={[
              { value: "", label: "Todas as ações" },
              ...(q.data?.acoes ?? []).map((a) => ({ value: a, label: a })),
            ]}
            value={acao}
            onChange={setAcao}
            className="w-64"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, conta, valor ou identificador"
            className={`${inputCls} max-w-sm`}
          />
        </div>

        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar a auditoria." /> : null}
        {q.data && q.data.rows.length === 0 ? (
          <EmptyState
            title="Nenhum registro no filtro"
            description="Ajuste o período ou a ação para ver o histórico."
          />
        ) : null}

        {q.data && q.data.rows.length > 0 ? (
          <div className="space-y-2">
            {q.data.rows.map((r) => (
              <details
                key={r.id}
                className="rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3"
              >
                <summary className="cursor-pointer list-none">
                  <span className="font-semibold text-ledger-text">{r.action}</span>
                  <span className="ml-2 text-xs text-ledger-muted">
                    {formatDateTime(r.created_at)} · {r.autor}
                  </span>
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-ledger-muted">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        ) : null}
      </Panel>
    </AreaFinanceiraGuard>
  );
}

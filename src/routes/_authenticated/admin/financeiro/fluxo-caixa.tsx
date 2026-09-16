import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { fetchFinAccounts, fetchFinCashflow } from "@/lib/financeiro";

interface Busca {
  de?: string;
  ate?: string;
  dias?: string;
  agrupamento?: string;
  conta?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/fluxo-caixa")({
  component: FluxoCaixa,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["de"] === "string" ? { de: s["de"] } : {}),
    ...(typeof s["ate"] === "string" ? { ate: s["ate"] } : {}),
    ...(typeof s["dias"] === "string" ? { dias: s["dias"] } : {}),
    ...(typeof s["agrupamento"] === "string" ? { agrupamento: s["agrupamento"] } : {}),
    ...(typeof s["conta"] === "string" ? { conta: s["conta"] } : {}),
  }),
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

function FluxoCaixa() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  const dias = Number(s.dias ?? 30);
  const agrupamento = s.agrupamento ?? "dia";
  const conta = s.conta ?? "";

  const hoje = new Date();
  const de = iso(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias));
  const ate = iso(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias));

  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });

  const q = useQuery({
    queryKey: ["fin-cashflow", de, ate, agrupamento, conta],
    queryFn: () =>
      fetchFinCashflow({
        de,
        ate,
        agrupamento,
        ...(conta ? { conta_id: conta } : {}),
      }),
  });

  const trocar = (campo: keyof Busca, valor: string) =>
    void navigate({
      to: "/admin/financeiro/fluxo-caixa",
      search: (prev: Busca) => ({ ...prev, [campo]: valor }),
      replace: true,
    });

  const rotuloBucket = (b: string) =>
    new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(
      new Date(`${b}T12:00:00`),
    );

  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <div className="space-y-6">
        <Panel title="Filtros">
          <div className="flex flex-wrap items-center gap-3">
            <SmartSelect
              options={[7, 30, 60, 90].map((d) => ({ value: String(d), label: `${d} dias` }))}
              value={String(dias)}
              onChange={(v) => trocar("dias", v)}
              className="w-40"
            />
            <SmartSelect
              options={[
                { value: "dia", label: "Por dia" },
                { value: "semana", label: "Por semana" },
                { value: "mes", label: "Por mês" },
              ]}
              value={agrupamento}
              onChange={(v) => trocar("agrupamento", v)}
              className="w-44"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todas as contas" },
                ...(contas.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
              ]}
              value={conta}
              onChange={(v) => trocar("conta", v)}
              className="w-60"
            />
          </div>
          <p className="mt-3 text-xs font-medium text-ledger-muted">
            O saldo realizado vem exclusivamente do razão. O previsto vem das parcelas em aberto.
          </p>
        </Panel>

        {q.isLoading ? <Skeleton className="h-48 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar o fluxo de caixa." /> : null}

        {q.data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Resumo rotulo="Saldo inicial" valor={q.data.saldo_inicial_cents} />
              <Resumo rotulo="Entradas realizadas" valor={q.data.totais.entradas_realizadas_cents} />
              <Resumo rotulo="Saídas realizadas" valor={q.data.totais.saidas_realizadas_cents} />
              <Resumo
                rotulo="Saldo realizado"
                valor={q.data.totais.saldo_final_realizado_cents}
              />
            </div>

            <Panel title="Posição por período" flush>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left">
                      <th className="px-5 py-3 font-semibold text-ledger-muted">Período</th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Entradas
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">Saídas</th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Previstas
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Saldo acumulado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.linhas.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-ledger-muted">
                          Nenhum movimento no período.
                        </td>
                      </tr>
                    ) : (
                      q.data.linhas.map((l) => (
                        <tr key={l.bucket} className="border-b border-line-soft/60">
                          <td className="px-5 py-3 font-semibold text-ledger-text">
                            {rotuloBucket(l.bucket)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-emerald-700">
                            {formatBRLFromCents(l.entradas_realizadas_cents)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-red-700">
                            {formatBRLFromCents(l.saidas_realizadas_cents)}
                          </td>
                          <td className="px-5 py-3 text-right tabular-nums text-ledger-muted">
                            {formatBRLFromCents(
                              l.entradas_previstas_cents - l.saidas_previstas_cents,
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-ledger-text">
                            {formatBRLFromCents(l.saldo_realizado_cents)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    </AreaFinanceiraGuard>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-ledger-text">
        {formatBRLFromCents(valor)}
      </p>
    </div>
  );
}

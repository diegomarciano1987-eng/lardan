import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import {
  fetchClassificacoes,
  fetchFinAccounts,
  fetchFinCashflow,
  fetchFinCashflowDetalhe,
  type FiltrosCashflow,
  type TipoDetalheFluxo,
} from "@/lib/financeiro";

interface Busca {
  de?: string;
  ate?: string;
  agrupamento?: string;
  conta?: string;
  centro?: string;
  entidade?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/fluxo-caixa")({
  component: FluxoCaixa,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["de"] === "string" ? { de: s["de"] } : {}),
    ...(typeof s["ate"] === "string" ? { ate: s["ate"] } : {}),
    ...(typeof s["agrupamento"] === "string" ? { agrupamento: s["agrupamento"] } : {}),
    ...(typeof s["conta"] === "string" ? { conta: s["conta"] } : {}),
    ...(typeof s["centro"] === "string" ? { centro: s["centro"] } : {}),
    ...(typeof s["entidade"] === "string" ? { entidade: s["entidade"] } : {}),
  }),
});

const TITULO_DETALHE: Record<TipoDetalheFluxo, string> = {
  realizado: "Movimentos realizados",
  transferencia: "Transferências entre contas",
  nao_classificado: "Movimentos sem classificação suficiente",
  previsto_entrada: "Entradas previstas em aberto",
  previsto_saida: "Saídas previstas em aberto",
};

function FluxoCaixa() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  const periodo = usePeriodoFinanceiro();
  const agrupamento = s.agrupamento ?? "dia";
  const conta = s.conta ?? "";
  const centro = s.centro ?? "";
  const entidade = s.entidade ?? "";
  const [detalhe, setDetalhe] = React.useState<TipoDetalheFluxo | null>(null);

  const filtros: FiltrosCashflow = {
    de: periodo.de,
    ate: periodo.ate,
    agrupamento,
    ...(conta ? { conta_id: conta } : {}),
    ...(centro ? { centro_custo_id: centro } : {}),
    ...(entidade ? { entidade_id: entidade } : {}),
  };

  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts });
  const classif = useQuery({
    queryKey: ["fin-classificacoes", "fluxo"],
    queryFn: () => fetchClassificacoes({}),
    staleTime: 60_000,
  });

  const q = useQuery({
    queryKey: ["fin-cashflow", filtros],
    queryFn: () => fetchFinCashflow(filtros),
  });

  const det = useQuery({
    queryKey: ["fin-cashflow-detalhe", filtros, detalhe],
    queryFn: () => fetchFinCashflowDetalhe({ ...filtros, tipo: detalhe as TipoDetalheFluxo }),
    enabled: detalhe !== null,
  });

  const trocar = (campo: keyof Busca, valor: string) =>
    void navigate({
      to: "/admin/financeiro/fluxo-caixa",
      search: (prev: Busca) => ({ ...prev, [campo]: valor }),
      replace: true,
    });

  const rotuloBucket = (b: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: agrupamento === "mes" ? undefined : "2-digit",
      month: "2-digit",
      year: agrupamento === "mes" ? "numeric" : undefined,
    }).format(new Date(`${b}T12:00:00`));

  const d = q.data;

  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <div className="space-y-6">
        <Panel title="Filtros">
          <div className="flex flex-wrap items-center gap-3">
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
            <SmartSelect
              options={[
                { value: "", label: "Todos os centros de custo" },
                ...(classif.data?.centros ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.codigo} · ${c.nome}`,
                })),
              ]}
              value={centro}
              onChange={(v) => trocar("centro", v)}
              className="w-64"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todas as entidades" },
                ...(classif.data?.entidades ?? []).map((e) => ({ value: e.id, label: e.nome })),
              ]}
              value={entidade}
              onChange={(v) => trocar("entidade", v)}
              className="w-56"
            />
          </div>
          <p className="mt-3 text-xs font-medium text-ledger-muted">
            O realizado vem exclusivamente dos movimentos das contas; o previsto, do saldo ainda em
            aberto das parcelas. O saldo de abertura fica separado das entradas e saídas do período.
            Transferências entre contas não inflam o consolidado. Ao filtrar por centro de custo ou
            entidade, movimentos sem classificação suficiente aparecem à parte, e não somem.
          </p>
        </Panel>

        {q.isLoading ? <Skeleton className="h-48 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar o fluxo de caixa." /> : null}

        {d ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Resumo rotulo="Saldo de abertura" valor={d.saldo_abertura_cents} />
              <Resumo
                rotulo="Entradas realizadas"
                valor={d.totais.entradas_realizadas_cents}
                onClick={() => setDetalhe("realizado")}
              />
              <Resumo
                rotulo="Saídas realizadas"
                valor={d.totais.saidas_realizadas_cents}
                onClick={() => setDetalhe("realizado")}
              />
              <Resumo rotulo="Saldo realizado" valor={d.totais.saldo_final_realizado_cents} />
              <Resumo
                rotulo="Entradas previstas"
                valor={d.totais.entradas_previstas_cents}
                onClick={() => setDetalhe("previsto_entrada")}
              />
              <Resumo
                rotulo="Saídas previstas"
                valor={d.totais.saidas_previstas_cents}
                onClick={() => setDetalhe("previsto_saida")}
              />
              <Resumo
                rotulo="Transferências entre contas"
                valor={d.totais.transferencias_cents}
                nota="Não entram no consolidado"
                onClick={() => setDetalhe("transferencia")}
              />
              <Resumo
                rotulo="Saldo projetado"
                valor={d.totais.saldo_final_projetado_cents}
                nota="Realizado + previsto"
              />
            </div>

            {d.filtros.classificacao_aplicada &&
            (d.totais.nao_classificado_entradas_cents > 0 ||
              d.totais.nao_classificado_saidas_cents > 0) ? (
              <Panel title="Sem classificação suficiente para o filtro">
                <div className="flex flex-wrap items-center gap-6">
                  <p className="text-sm font-medium text-ledger-text">
                    Entradas{" "}
                    <strong className="tabular-nums">
                      {formatBRLFromCents(d.totais.nao_classificado_entradas_cents)}
                    </strong>{" "}
                    · Saídas{" "}
                    <strong className="tabular-nums">
                      {formatBRLFromCents(d.totais.nao_classificado_saidas_cents)}
                    </strong>
                  </p>
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => setDetalhe("nao_classificado")}
                  >
                    Ver lançamentos
                  </button>
                </div>
              </Panel>
            ) : null}

            <Panel title="Curva do caixa no período">
              {d.linhas.length === 0 ? (
                <p className="py-10 text-center text-sm text-ledger-muted">
                  Nenhum movimento ou parcela no período selecionado.
                </p>
              ) : (
                <div className="h-[340px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={d.linhas.map((l) => ({
                        rotulo: rotuloBucket(l.bucket),
                        entradas: l.entradas_realizadas_cents / 100,
                        saidas: l.saidas_realizadas_cents / 100,
                        aPagar: l.saidas_previstas_cents / 100,
                        aReceber: l.entradas_previstas_cents / 100,
                        realizado: l.saldo_realizado_cents / 100,
                        projetado: l.saldo_projetado_cents / 100,
                      }))}
                      margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                    >
                      <defs>
                        <linearGradient id="fluxoRealizado" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#8a6a3b" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="#c8a165" stopOpacity={1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 6" stroke="currentColor" opacity={0.12} />
                      <XAxis
                        dataKey="rotulo"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12 }}
                        minTickGap={16}
                      />
                      <YAxis
                        yAxisId="movimento"
                        tickLine={false}
                        axisLine={false}
                        width={84}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          new Intl.NumberFormat("pt-BR", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(v)
                        }
                      />
                      <YAxis
                        yAxisId="saldo"
                        orientation="right"
                        tickLine={false}
                        axisLine={false}
                        width={84}
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          new Intl.NumberFormat("pt-BR", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(v)
                        }
                      />
                      <Tooltip
                        formatter={(v: number | string, nome: string) => [
                          formatBRLFromCents(Math.round(Number(v) * 100)),
                          nome,
                        ]}
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.08)",
                          fontSize: 13,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      <Line
                        type="monotone"
                        dataKey="entradas"
                        name="Entradas"
                        stroke="#127f57"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="saidas"
                        name="Saídas"
                        stroke="#b23a34"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="realizado"
                        name="Saldo realizado"
                        stroke="url(#fluxoRealizado)"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="projetado"
                        name="Saldo projetado"
                        stroke="#6b7280"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Posição por período" flush>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left">
                      <th className="px-5 py-3 font-semibold text-ledger-muted">Período</th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Entradas
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Saídas
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Previsto líquido
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Saldo realizado
                      </th>
                      <th className="px-5 py-3 text-right font-semibold text-ledger-muted">
                        Saldo projetado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.linhas.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-ledger-muted">
                          Nenhum movimento ou parcela no período.
                        </td>
                      </tr>
                    ) : (
                      d.linhas.map((l) => (
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
                          <td className="px-5 py-3 text-right tabular-nums text-ledger-muted">
                            {formatBRLFromCents(l.saldo_projetado_cents)}
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

        <Dialog open={detalhe !== null} onOpenChange={(v) => !v && setDetalhe(null)}>
          <DialogContent className="admin-scope max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{detalhe ? TITULO_DETALHE[detalhe] : ""}</DialogTitle>
              <DialogDescription>
                Mesmos filtros e período da tela. A soma abaixo fecha com o total apresentado.
              </DialogDescription>
            </DialogHeader>
            {det.isLoading ? <Skeleton className="h-32 w-full" /> : null}
            {det.error ? <ErrorState message="Não foi possível abrir o detalhamento." /> : null}
            {det.data ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold tabular-nums text-ledger-text">
                  Soma: {formatBRLFromCents(det.data.soma_cents)} · {det.data.rows.length}{" "}
                  lançamento(s)
                </p>
                <ul className="divide-y divide-line-soft/60 text-sm">
                  {det.data.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-ledger-text">
                        {new Date(`${r.data}T12:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                        {r.descricao ?? r.contraparte ?? r.kind ?? "—"}
                        {r.conta ? <span className="text-ledger-muted"> · {r.conta}</span> : null}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {formatBRLFromCents(r.valor_cents)}
                      </span>
                    </li>
                  ))}
                  {det.data.rows.length === 0 ? (
                    <li className="py-4 text-center text-ledger-muted">Nenhum lançamento.</li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </AreaFinanceiraGuard>
  );
}

function Resumo({
  rotulo,
  valor,
  nota,
  onClick,
}: {
  rotulo: string;
  valor: number;
  nota?: string;
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-ledger-text">
        {formatBRLFromCents(valor)}
      </p>
      {nota ? <p className="mt-0.5 text-xs font-medium text-ledger-muted">{nota}</p> : null}
    </>
  );
  if (!onClick) return <div className="ledger-panel px-5 py-4">{conteudo}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="ledger-panel px-5 py-4 text-left transition-colors hover:border-champagne focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none"
    >
      {conteudo}
    </button>
  );
}

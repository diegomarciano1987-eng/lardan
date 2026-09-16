import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ErrorState,
  Panel,
  Skeleton,
  formatBRLFromCents,
  formatInt,
} from "@/components/admin/ui";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import { fetchFinOverviewPeriodo } from "@/lib/financeiro";
import { supabase } from "@/integrations/supabase/client";

interface Busca {
  de?: string;
  ate?: string;
}


export const Route = createFileRoute("/_authenticated/admin/financeiro/")({
  component: VisaoGeral,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["de"] === "string" ? { de: s["de"] } : {}),
    ...(typeof s["ate"] === "string" ? { ate: s["ate"] } : {}),
  }),
});

function Kpi({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "entrada" | "saida";
}) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p
        className={
          "mt-1 font-display text-[1.6rem] font-bold tabular-nums " +
          (tom === "saida" ? "text-red-700" : tom === "entrada" ? "text-emerald-700" : "text-ledger-text")
        }
      >
        {valor}
      </p>
      {nota ? <p className="mt-1 text-xs font-medium text-ledger-muted">{nota}</p> : null}
    </div>
  );
}

/** Pendências de conciliação lidas do servidor, sem número inventado. */
function usePendenciasConciliacao() {
  return useQuery({
    queryKey: ["fin-statement-overview", "resumo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fin_statement_overview", {
        _filtros: {} as unknown as never,
      });
      if (error) throw error;
      const d = (data ?? {}) as Record<string, unknown>;
      const totais = (d["totais"] ?? {}) as Record<string, number>;
      return {
        pendentes: Number(totais["pendentes"] ?? 0),
        divergentes: Number(totais["divergentes"] ?? 0),
      };
    },
    retry: false,
  });
}

function VisaoGeral() {
  const { de, ate } = usePeriodoFinanceiro();

  const q = useQuery({
    queryKey: ["fin-overview", de, ate],
    queryFn: () => fetchFinOverviewPeriodo(de, ate),
  });
  const conc = usePendenciasConciliacao();

  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <div className="space-y-6">
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar o painel financeiro." /> : null}

        {q.data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi
                rotulo="Saldo em contas"
                valor={formatBRLFromCents(q.data.saldo_contas_cents)}
                nota="Calculado pelo razão"
              />
              <Kpi
                rotulo="A receber em aberto"
                valor={formatBRLFromCents(q.data.a_receber_cents)}
                tom="entrada"
              />
              <Kpi
                rotulo="A pagar em aberto"
                valor={formatBRLFromCents(q.data.a_pagar_cents)}
                tom="saida"
              />
              <Kpi
                rotulo="Aguardando aprovação"
                valor={formatInt(q.data.titulos_pendentes_aprovacao)}
                nota="Títulos submetidos"
              />
            </div>

            <Panel title="No período selecionado">
              <div className="grid gap-4 sm:grid-cols-2">
                <Kpi
                  rotulo="Recebido"
                  valor={formatBRLFromCents(q.data.recebido_periodo_cents)}
                  tom="entrada"
                />
                <Kpi rotulo="Pago" valor={formatBRLFromCents(q.data.pago_periodo_cents)} tom="saida" />
              </div>
            </Panel>

            <Panel title="Vencidos">
              <div className="grid gap-4 sm:grid-cols-2">
                <Kpi
                  rotulo="Vencido a receber"
                  valor={formatBRLFromCents(q.data.vencido_receber_cents)}
                  nota="Dinheiro que deveria ter entrado"
                  tom="entrada"
                />
                <Kpi
                  rotulo="Vencido a pagar"
                  valor={formatBRLFromCents(q.data.vencido_pagar_cents)}
                  nota="Dinheiro que deveria ter saído"
                  tom="saida"
                />
              </div>
              <p className="mt-3 text-xs font-medium text-ledger-muted">
                São naturezas opostas: um é entrada atrasada, o outro é saída atrasada. Por isso não
                aparecem somados.
              </p>
            </Panel>

            <Panel title="Projeção de caixa">
              <div className="grid gap-4 sm:grid-cols-3">
                {[30, 60, 90].map((dias) => {
                  const receber = q.data[
                    `proj${dias}_receber_cents` as keyof typeof q.data
                  ] as number;
                  const pagar = q.data[`proj${dias}_pagar_cents` as keyof typeof q.data] as number;
                  return (
                    <div
                      key={dias}
                      className="rounded-[12px] border border-line-soft bg-cream-2 p-4"
                    >
                      <p className="ledger-eyebrow">Próximos {dias} dias</p>
                      <p className="mt-2 text-sm font-semibold tabular-nums text-ledger-text">
                        Entradas previstas {formatBRLFromCents(receber ?? 0)}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-ledger-text">
                        Saídas previstas {formatBRLFromCents(pagar ?? 0)}
                      </p>
                      <p className="mt-1 text-xs font-medium text-ledger-muted">
                        Resultado previsto {formatBRLFromCents((receber ?? 0) - (pagar ?? 0))}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Conciliação bancária">
              <div className="grid gap-4 sm:grid-cols-2">
                <Kpi
                  rotulo="Linhas pendentes"
                  valor={conc.data ? formatInt(conc.data.pendentes) : "—"}
                  nota="Extratos aguardando conciliação"
                />
                <Kpi
                  rotulo="Divergências"
                  valor={conc.data ? formatInt(conc.data.divergentes) : "—"}
                  nota="Linhas marcadas como divergentes"
                />
              </div>
            </Panel>

            <Panel title="Atalhos">
              <div className="flex flex-wrap gap-2">
                <Atalho to="/admin/financeiro/pagar" texto="Criar conta a pagar" />
                <Atalho to="/admin/financeiro/receber" texto="Criar conta a receber" />
                <Atalho to="/admin/financeiro/contas" texto="Registrar baixa e contas" />
                <Atalho to="/admin/financeiro/conciliacao" texto="Abrir conciliação" />
                <Atalho to="/admin/financeiro/aprovacoes" texto="Consultar pendências" />
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    </AreaFinanceiraGuard>
  );
}

function Atalho({ to, texto }: { to: string; texto: string }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 items-center rounded-[10px] border border-line-soft bg-cream-2 px-4 text-sm font-semibold text-ledger-text transition hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
    >
      {texto}
    </Link>
  );
}

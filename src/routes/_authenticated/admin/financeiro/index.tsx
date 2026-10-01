import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
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

const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/** Card que abre exatamente a lista que produziu o valor. */
function CardComposicao({
  rotulo,
  valor,
  nota,
  tom,
  to,
  search,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  tom?: "entrada" | "saida" | "asaas";
  to: string;
  search: Record<string, unknown>;
}) {
  return (
    <Link
      to={to}
      search={search as never}
      className={`group flex min-h-[7.5rem] flex-col justify-between rounded-[14px] border bg-surface px-5 py-4 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none ${tom === "asaas" ? "border-asaas/40 focus-visible:ring-asaas" : "border-line-soft focus-visible:ring-champagne"}`}
    >
      <div>
        <p className="ledger-eyebrow">{rotulo}</p>
        <p
          className={
            "mt-1 font-display text-[1.65rem] leading-tight font-bold tabular-nums " +
            (tom === "saida" ? "text-destructive" : tom === "entrada" ? "text-emerald-700" : "text-ledger-text")
          }
        >
          {valor}
        </p>
        {nota ? <p className="mt-1 text-xs font-medium text-ledger-muted">{nota}</p> : null}
      </div>
      <span className="mt-2 text-xs font-semibold text-ledger-text underline-offset-4 group-hover:underline">
        Ver composição →
      </span>
    </Link>
  );
}

function usePendenciasConciliacao(de: string, ate: string) {
  return useQuery({
    queryKey: ["fin-statement-overview", "resumo", de, ate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fin_statement_overview", {
        _filtros: { de, ate } as unknown as never,
      });
      if (error) throw error;
      const d = (data ?? {}) as Record<string, unknown>;
      // a função devolve os contadores no primeiro nível (não em "totais")
      return {
        pendentes: Number(d["pendentes"] ?? 0),
        divergentes: Number(d["divergentes"] ?? 0),
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
  const conc = usePendenciasConciliacao(de, ate);
  const per = { de, ate };
  const d = q.data;

  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <div className="space-y-6">
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? (
          <ErrorState message={`Não foi possível carregar o painel: ${(q.error as Error).message}`} onRetry={() => void q.refetch()} />
        ) : null}

        {d ? (
          <>
            <p className="text-sm font-medium text-ledger-muted">
              Período {dataBR(d.periodo.de)} a {dataBR(d.periodo.ate)} · saldos na data {dataBR(d.data_corte_saldo)}
            </p>
            <section aria-label="Indicadores do período" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <CardComposicao
                rotulo="A receber em aberto no período"
                valor={formatBRLFromCents(d.a_receber_cents)}
                nota={`${formatInt(d.a_receber_lardan_qtd)} parcela(s) Lardan ${formatBRLFromCents(d.a_receber_lardan_cents)} + ${formatInt(d.a_receber_asaas_qtd)} cobrança(s) Asaas ${formatBRLFromCents(d.a_receber_asaas_cents)}`}
                tom="entrada"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "receber", situacao: "aberto" }}
              />
              <CardComposicao
                rotulo="A pagar em aberto no período"
                valor={formatBRLFromCents(d.a_pagar_cents)}
                nota={`${formatInt(d.a_pagar_qtd)} parcela(s) com vencimento no período`}
                tom="saida"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "pagar", situacao: "aberto" }}
              />
              <CardComposicao
                rotulo={`Saldo em contas até ${dataBR(d.data_corte_saldo)}`}
                valor={formatBRLFromCents(d.saldo_contas_cents)}
                nota="Posição acumulada pelo razão"
                to="/admin/financeiro/contas"
                search={per}
              />
              <CardComposicao
                rotulo="Recebido no período"
                valor={formatBRLFromCents(d.recebido_periodo_cents)}
                nota={`${formatInt(d.recebido_qtd)} liquidação(ões) pela data de pagamento`}
                tom="entrada"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "receber", visao: "liquidacoes" }}
              />
              <CardComposicao
                rotulo="Pago no período"
                valor={formatBRLFromCents(d.pago_periodo_cents)}
                nota={`${formatInt(d.pago_qtd)} liquidação(ões) pela data de pagamento`}
                tom="saida"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "pagar", visao: "liquidacoes" }}
              />
              {d.asaas_recebido_conferir_qtd > 0 ? (
                <CardComposicao
                  rotulo="Recebido no Asaas a conferir"
                  valor={formatBRLFromCents(d.asaas_recebido_conferir_cents)}
                  nota={`${formatInt(d.asaas_recebido_conferir_qtd)} cobrança(s) já pagas no Asaas e ainda sem vínculo; fora do "Recebido" para não contar duas vezes`}
                  tom="asaas"
                  to="/admin/financeiro/pagar-receber"
                  search={{ ...per, natureza: "receber", origem: "asaas", situacao: "quitado" }}
                />
              ) : null}
            </section>

            <section aria-label="Vencidos" className="grid gap-3 sm:grid-cols-2">
              <CardComposicao
                rotulo="Vencido a receber no período"
                valor={formatBRLFromCents(d.vencido_receber_cents)}
                nota={`${formatInt(d.vencido_receber_qtd)} vencidas antes de ${dataBR(d.data_referencia_vencidos)} (Asaas: ${formatInt(d.vencido_receber_asaas_qtd)}) · atrasos anteriores ao período: ${formatBRLFromCents(d.atraso_anterior_receber_cents)}, sendo Asaas ${formatBRLFromCents(d.atraso_anterior_receber_asaas_cents)}`}
                tom="entrada"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "receber", situacao: "vencido" }}
              />
              <CardComposicao
                rotulo="Vencido a pagar no período"
                valor={formatBRLFromCents(d.vencido_pagar_cents)}
                nota={`${formatInt(d.vencido_pagar_qtd)} parcela(s) vencidas antes de ${dataBR(d.data_referencia_vencidos)} · atrasos anteriores ao período: ${formatBRLFromCents(d.atraso_anterior_pagar_cents)}`}
                tom="saida"
                to="/admin/financeiro/pagar-receber"
                search={{ ...per, natureza: "pagar", situacao: "vencido" }}
              />
            </section>

            <Panel title="Projeção a partir de hoje">
              <div className="grid gap-4 sm:grid-cols-3">
                {[30, 60, 90].map((dias) => {
                  const receber = d[`proj${dias}_receber_cents` as keyof typeof d] as number;
                  const pagar = d[`proj${dias}_pagar_cents` as keyof typeof d] as number;
                  return (
                    <div key={dias} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                      <p className="ledger-eyebrow">Próximos {dias} dias</p>
                      <p className="mt-2 text-sm font-semibold tabular-nums text-ledger-text">
                        Entradas previstas {formatBRLFromCents(receber ?? 0)}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-ledger-text">
                        Saídas previstas {formatBRLFromCents(pagar ?? 0)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <section aria-label="Conciliação" className="grid gap-3 sm:grid-cols-2">
              <CardComposicao
                rotulo="Linhas de extrato pendentes"
                valor={conc.error ? "Erro ao ler" : conc.data ? formatInt(conc.data.pendentes) : "…"}
                nota="Aguardando conciliação no período"
                to="/admin/financeiro/conciliacao"
                search={per}
              />
              <CardComposicao
                rotulo="Aguardando aprovação"
                valor={formatInt(d.titulos_pendentes_aprovacao)}
                nota="Títulos submetidos"
                to="/admin/financeiro/aprovacoes"
                search={per}
              />
            </section>
          </>
        ) : null}
      </div>
    </AreaFinanceiraGuard>
  );
}

import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";

export const Route = createFileRoute("/_authenticated/admin/financeiro/dfc")({
  component: DfcTela,
  head: () => ({ meta: [{ title: "DFC e projeção — Financeiro LARDAN" }] }),
});

interface Atividade {
  entradas_cents: number;
  saidas_cents: number;
  liquido_cents: number;
  linhas: { linha: string; entradas_cents: number; saidas_cents: number; liquido_cents: number }[];
}
interface Dfc {
  periodo: { de: string; ate: string; realizado_ate: string };
  criterio: string;
  atividades: Record<string, Atividade>;
  saldo_inicial_cents: number;
  saldo_final_cents: number;
  variacao_cents: number;
  contas: { conta: string; inicial_cents: number; entradas_cents: number; saidas_cents: number; final_cents: number; confere: boolean }[];
}
interface Projecao {
  hoje: string;
  saldo_hoje_cents: number;
  vencidos_receber_cents: number;
  vencidos_pagar_cents: number;
  fiado_no_periodo_cents: number;
  cheques_sem_data_cents: number;
  cheques_ja_no_titulo_cents?: number;
  fiado_pct?: number;
  fiado_pct_historico?: number | null;
  criterio: string;
  linhas: { data: string; receber_cents: number; fiado_cents?: number; cheques_cents: number; pagar_cents: number; outros_cents: number; saldo_projetado_cents: number }[];
}

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(f as never, a as never);
  if (error) throw new Error((error as { message: string }).message);
  return data as T;
}

const ORDEM: [string, string][] = [
  ["operacional", "Atividades operacionais"],
  ["investimento", "Atividades de investimento"],
  ["financiamento", "Atividades de financiamento"],
  ["nao_classificado", "Baixas sem conta contábil"],
  ["ajustes", "Ajustes de saldo"],
  ["saldo_inicial", "Saldos de abertura lançados no período"],
  ["transferencias", "Transferências entre contas (líquido)"],
];
const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

function DfcTela() {
  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <div className="space-y-4">
        <DfcPainel />
        <ProjecaoPainel />
      </div>
    </AreaFinanceiraGuard>
  );
}

function DfcPainel() {
  const { de, ate } = usePeriodoFinanceiro();
  const q = useQuery({ queryKey: ["fin-dfc", de, ate], queryFn: () => rpc<Dfc>("fin_dfc", { _de: de, _ate: ate }) });
  const [aberto, setAberto] = React.useState<string | null>("operacional");
  const d = q.data;
  return (
    <Panel title="DFC realizado — método direto">
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <ErrorState message={(q.error as Error).message} /> : null}
      {d ? (
        <div className="space-y-4">
          <p className="text-xs text-ledger-muted">{d.criterio} Realizado até {dataBR(d.periodo.realizado_ate)}.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Caixa rotulo="Saldo inicial" v={d.saldo_inicial_cents} />
            <Caixa rotulo="Variação no período" v={d.variacao_cents} />
            <Caixa rotulo="Saldo final" v={d.saldo_final_cents} />
          </div>
          <p className={`text-xs font-semibold ${d.saldo_inicial_cents + d.variacao_cents === d.saldo_final_cents ? "text-ledger-text" : "text-destructive"}`}>
            Conferência: inicial + variação = final →{" "}
            {d.saldo_inicial_cents + d.variacao_cents === d.saldo_final_cents ? "bate" : "não bate"}
          </p>
          <div className="divide-y divide-line-soft rounded-[12px] border border-line-soft">
            {ORDEM.filter(([k]) => d.atividades[k]).map(([k, rot]) => {
              const a = d.atividades[k]!;
              return (
                <div key={k}>
                  <button type="button" onClick={() => setAberto(aberto === k ? null : k)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                    <span className="font-semibold text-ledger-text">{rot}</span>
                    <span className="text-sm tabular-nums">
                      entradas {formatBRLFromCents(a.entradas_cents)} · saídas {formatBRLFromCents(a.saidas_cents)} ·{" "}
                      <strong>{formatBRLFromCents(a.liquido_cents)}</strong>
                    </span>
                  </button>
                  {aberto === k ? (
                    <table className="w-full text-sm">
                      <tbody>
                        {a.linhas.map((l) => (
                          <tr key={l.linha} className="border-t border-line-soft">
                            <td className="px-6 py-1.5">{l.linha}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatBRLFromCents(l.entradas_cents)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatBRLFromCents(-l.saidas_cents)}</td>
                            <td className="px-4 py-1.5 text-right font-semibold tabular-nums">{formatBRLFromCents(l.liquido_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-ledger-muted">
                <tr><th className="py-2">Conta</th><th className="text-right">Inicial</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Final</th><th className="text-right">Confere</th></tr>
              </thead>
              <tbody>
                {d.contas.map((c) => (
                  <tr key={c.conta} className="border-t border-line-soft">
                    <td className="py-1.5">{c.conta}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(c.inicial_cents)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(c.entradas_cents)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(-c.saidas_cents)}</td>
                    <td className="text-right font-semibold tabular-nums">{formatBRLFromCents(c.final_cents)}</td>
                    <td className="text-right">{c.confere ? "sim" : "não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ProjecaoPainel() {
  const [dias, setDias] = React.useState(60);
  const [comFiado, setComFiado] = React.useState(false);
  const [pctTxt, setPctTxt] = React.useState("");
  const pct = comFiado ? Math.min(100, Math.max(0, Number(pctTxt.replace(",", ".")) || 0)) : null;
  const q = useQuery({
    queryKey: ["fin-projecao", dias, pct],
    queryFn: () => rpc<Projecao>("fin_projecao_diaria", { _dias: dias, _fiado_pct: pct }),
  });
  const d = q.data;
  const hist = d?.fiado_pct_historico ?? null;
  React.useEffect(() => {
    if (comFiado && pctTxt === "" && hist != null) setPctTxt(String(hist).replace(".", ","));
  }, [comFiado, hist, pctTxt]);
  const menor = d?.linhas.reduce((m, l) => (l.saldo_projetado_cents < m.saldo_projetado_cents ? l : m), d.linhas[0]!);
  return (
    <Panel title="Fluxo de caixa projetado — dia a dia">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[30, 60, 90].map((n) => (
          <button key={n} type="button" onClick={() => setDias(n)} className={`admin-btn ${dias === n ? "admin-btn-primary" : ""}`}>
            {n} dias
          </button>
        ))}
        <span className="mx-2 h-6 w-px bg-line-soft" />
        <button type="button" onClick={() => setComFiado((v) => !v)} className={`admin-btn ${comFiado ? "admin-btn-primary" : ""}`}>
          {comFiado ? "Somando fiado previsto" : "Somar fiado/consignado previsto"}
        </button>
        {comFiado ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              inputMode="decimal"
              value={pctTxt}
              onChange={(e) => setPctTxt(e.target.value.replace(/[^\d,.]/g, ""))}
              className="admin-input w-20 text-right tabular-nums"
              aria-label="Percentual de recebimento do fiado"
            />
            % de recebimento
            {hist != null ? <span className="text-xs text-ledger-muted">(histórico: {String(hist).replace(".", ",")}%)</span> : null}
          </label>
        ) : null}
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : null}
      {q.error ? <ErrorState message={(q.error as Error).message} /> : null}
      {d ? (
        <div className="space-y-4">
          <p className="text-xs text-ledger-muted">{d.criterio}</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Caixa rotulo="Saldo hoje" v={d.saldo_hoje_cents} />
            <Caixa rotulo="Menor saldo previsto" v={menor?.saldo_projetado_cents ?? 0} nota={menor ? dataBR(menor.data) : ""} />
            <Caixa rotulo="Vencido a receber (fora)" v={d.vencidos_receber_cents} />
            <Caixa rotulo="Vencido a pagar (fora)" v={d.vencidos_pagar_cents} />
          </div>
          <p className="text-xs text-ledger-muted">
            Fiado histórico vencendo no período: {formatBRLFromCents(d.fiado_no_periodo_cents)}
            {comFiado ? ` (somando ${String(d.fiado_pct ?? 0).replace(".", ",")}% na linha)` : " (fora da linha)"} · cheques em mãos já vencidos ou sem data: {formatBRLFromCents(d.cheques_sem_data_cents)}
            {d.cheques_ja_no_titulo_cents ? ` · cheques que já estão como parcela a receber (não somados de novo): ${formatBRLFromCents(d.cheques_ja_no_titulo_cents)}` : ""}
          </p>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={d.linhas.map((l) => ({ dia: dataBR(l.data).slice(0, 5), saldo: l.saldo_projetado_cents / 100 }))}>
                <XAxis dataKey="dia" fontSize={11} />
                <YAxis fontSize={11} width={80} />
                <Tooltip formatter={(v: number) => formatBRLFromCents(Math.round(v * 100))} />
                <Line type="monotone" dataKey="saldo" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-ledger-muted">
                <tr><th className="py-2">Dia</th><th className="text-right">A receber</th><th className="text-right">Cheques</th><th className="text-right">A pagar</th><th className="text-right">Outros</th><th className="text-right">Saldo previsto</th></tr>
              </thead>
              <tbody>
                {d.linhas.filter((l) => l.receber_cents || l.cheques_cents || l.pagar_cents || l.outros_cents).map((l) => (
                  <tr key={l.data} className="border-t border-line-soft">
                    <td className="py-1.5">{dataBR(l.data)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(l.receber_cents)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(l.cheques_cents)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(-l.pagar_cents)}</td>
                    <td className="text-right tabular-nums">{formatBRLFromCents(l.outros_cents)}</td>
                    <td className={`text-right font-semibold tabular-nums ${l.saldo_projetado_cents < 0 ? "text-destructive" : ""}`}>{formatBRLFromCents(l.saldo_projetado_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function Caixa({ rotulo, v, nota }: { rotulo: string; v: number; nota?: string }) {
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className={`mt-1 font-display text-xl font-bold tabular-nums ${v < 0 ? "text-destructive" : "text-ledger-text"}`}>{formatBRLFromCents(v)}</p>
      {nota ? <p className="text-xs text-ledger-muted">{nota}</p> : null}
    </div>
  );
}

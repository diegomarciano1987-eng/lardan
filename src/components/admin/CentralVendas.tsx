/**
 * 0211 — Central de vendas (Inteligência Operacional): tudo o que as consultoras venderam pelo app e pela vitrine.
 * Números só do banco (central_vendas): totais, formas, dias, ranking, praças, representantes e últimas vendas.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crown, Store, TrendingDown, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

type Forma = "pix" | "cartao" | "boleto" | "dinheiro" | "receber_depois" | "marcada_feita" | "sem_forma";
interface Central {
  de: string; ate: string;
  resumo: { vendas: number; valor_cents: number; pecas: number; consultoras: number; pago_lardan_cents: number; a_receber_cents: number;
    vitrine_cents: number; vitrine_vendas: number; anterior_valor_cents: number; anterior_vendas: number };
  formas: { forma: Forma; vendas: number; valor_cents: number }[];
  dias: { dia: string; vendas: number; valor_cents: number; vitrine_cents: number }[];
  ranking: { party_id: string; nome: string; codigo: string | null; praca: string | null; representante: string | null; vendas: number; valor_cents: number; pecas: number; vitrine_cents: number }[];
  pracas: { praca: string; codigo: number | null; vendas: number; valor_cents: number; consultoras: number }[];
  representantes: { representante: string; vendas: number; valor_cents: number; consultoras: number }[];
  ultimas: { codigo: string; data: string; consultora: string; cliente: string; valor_cents: number; pecas: number; forma: Forma; canal: string; pago: boolean }[];
}

const FORMA: Record<Forma, string> = {
  pix: "Pix (Lardan)", cartao: "Cartão (Lardan)", boleto: "Boleto/link (Lardan)", dinheiro: "Dinheiro",
  receber_depois: "Receber depois (fiado)", marcada_feita: "Marcada como feita", sem_forma: "Sem forma definida",
};
const CORES = ["var(--color-rose)", "var(--color-asaas)", "var(--color-bronze)", "var(--color-success)", "var(--color-champagne)", "var(--color-rose-deep)", "var(--color-ledger-muted)"];
const MUTED = "var(--color-ledger-muted)";
const compacto = (c: number) => { const r = c / 100; return Math.abs(r) >= 1000 ? `R$ ${(r / 1000).toFixed(r >= 10000 ? 0 : 1)} mil` : `R$ ${r.toFixed(0)}`; };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

type Periodo = "hoje" | "7d" | "mes" | "anterior" | "90d";
const PERIODOS: [Periodo, string][] = [["hoje", "Hoje"], ["7d", "7 dias"], ["mes", "Este mês"], ["anterior", "Mês passado"], ["90d", "90 dias"]];
function intervalo(p: Periodo) {
  const h = new Date();
  const menos = (n: number) => { const d = new Date(h); d.setDate(d.getDate() - n); return iso(d); };
  if (p === "hoje") return { de: iso(h), ate: iso(h) };
  if (p === "7d") return { de: menos(6), ate: iso(h) };
  if (p === "90d") return { de: menos(89), ate: iso(h) };
  if (p === "anterior") return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
  return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h) };
}

export function CentralVendas() {
  const [p, setP] = useState<Periodo>("mes");
  const { de, ate } = intervalo(p);
  const q = useQuery({
    queryKey: ["central-vendas", de, ate],
    staleTime: 60_000,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("central_vendas" as never, { _de: de, _ate: ate } as never);
      if (error) throw error;
      return data as unknown as Central;
    },
  });
  if (q.isError) return <ErrorState message={(q.error as Error).message || "Não foi possível montar a Central de vendas."} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const r = d?.resumo;
  const variacao = r && Number(r.anterior_valor_cents) > 0 ? ((Number(r.valor_cents) - Number(r.anterior_valor_cents)) / Number(r.anterior_valor_cents)) * 100 : null;
  const ticket = r && Number(r.vendas) > 0 ? Number(r.valor_cents) / Number(r.vendas) : 0;
  const maxPraca = Math.max(1, ...(d?.pracas ?? []).map((x) => Number(x.valor_cents)));

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Período da Central de vendas">
        {PERIODOS.map(([k, rot]) => (
          <button key={k} type="button" onClick={() => setP(k)} aria-current={p === k ? "page" : undefined} className={p === k ? "admin-btn-primary text-warm-ivory" : "admin-btn"}>{rot}</button>
        ))}
      </nav>

      {!d || !r ? (
        <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="ledger-panel px-5 py-4">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">Total vendido</p>
              <p className="num mt-1.5 font-display text-[1.9rem] font-semibold leading-none text-ledger-text">{formatBRLFromCents(Number(r.valor_cents))}</p>
              <p className="mt-1.5 flex items-center gap-1 text-xs text-ledger-muted">
                {variacao === null ? "sem base no período anterior" : (
                  <span className={cn("inline-flex items-center gap-1 font-semibold", variacao >= 0 ? "text-success" : "text-rose-deep")}>
                    {variacao >= 0 ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}{variacao >= 0 ? "+" : ""}{variacao.toFixed(0)}%
                  </span>
                )}{variacao !== null && " vs. período anterior"}
              </p>
            </div>
            <Kpi rotulo="Vendas" valor={formatInt(Number(r.vendas))} detalhe={`${formatInt(Number(r.pecas))} peças · ticket médio ${formatBRLFromCents(ticket)}`} />
            <Kpi rotulo="Consultoras vendendo" valor={formatInt(Number(r.consultoras))} detalhe="com pelo menos uma venda no período" />
            <Kpi rotulo="Vendido pela vitrine" valor={formatBRLFromCents(Number(r.vitrine_cents))} detalhe={`${formatInt(Number(r.vitrine_vendas))} compras no link da consultora`} />
            <Kpi rotulo="Pago à Lardan (Asaas)" valor={formatBRLFromCents(Number(r.pago_lardan_cents))} detalhe="Pix, cartão e boleto: abatem no acerto" />
            <Kpi rotulo="A receber das clientes" valor={formatBRLFromCents(Number(r.a_receber_cents))} detalhe="cobranças e fiado ainda não pagos" alerta={Number(r.a_receber_cents) > 0} />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Vendas por dia">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.dias.map((x) => ({ ...x, app: Number(x.valor_cents) - Number(x.vitrine_cents), vitrine: Number(x.vitrine_cents) }))} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={MUTED} strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={(x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}`} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={12} />
                    <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip formatter={(v: number, n: string) => [formatBRLFromCents(v), n]} labelFormatter={(x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`} cursor={{ fill: MUTED, fillOpacity: 0.08 }} />
                    <Bar dataKey="app" name="App da consultora" stackId="v" fill="var(--color-rose)" />
                    <Bar dataKey="vitrine" name="Vitrine" stackId="v" fill="var(--color-asaas)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Formas de pagamento">
              {d.formas.length === 0 ? <p className="text-sm text-ledger-muted">Sem vendas no período.</p> : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={d.formas.map((f) => ({ nome: FORMA[f.forma] ?? f.forma, valor: Number(f.valor_cents) }))} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={82} paddingAngle={2} stroke="none">
                          {d.formas.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatBRLFromCents(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="w-full space-y-1 text-xs">
                    {d.formas.map((f, i) => (
                      <li key={f.forma} className="flex items-center gap-2">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: CORES[i % CORES.length] }} />
                        <span className="min-w-0 flex-1 truncate text-ledger-text">{FORMA[f.forma] ?? f.forma}</span>
                        <span className="num text-ledger-muted">{formatInt(Number(f.vendas))} · {formatBRLFromCents(Number(f.valor_cents))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Panel title="Quem mais vendeu" flush>
              {d.ranking.length === 0 ? <p className="px-6 py-5 text-sm text-ledger-muted">Sem vendas no período.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-ledger-muted">
                      <th className="px-4 py-2">#</th><th className="px-4 py-2">Consultora</th><th className="px-4 py-2">Praça · representante</th>
                      <th className="px-4 py-2 text-right">Vendas</th><th className="px-4 py-2 text-right">Valor</th></tr></thead>
                    <tbody>{d.ranking.slice(0, 20).map((c, i) => (
                      <tr key={c.party_id} className="border-b border-line-soft last:border-0">
                        <td className="px-4 py-2.5 text-ledger-muted">{i < 3 ? <Crown className={cn("size-4", i === 0 ? "text-bronze" : "text-ledger-muted")} aria-label={`${i + 1}º lugar`} /> : i + 1}</td>
                        <td className="px-4 py-2.5"><span className="block font-semibold text-ledger-text">{c.nome}</span><span className="text-xs text-ledger-muted">{c.codigo ?? ""}{Number(c.vitrine_cents) > 0 && <span className="ml-1 inline-flex items-center gap-0.5 text-asaas"><Store className="size-3" aria-hidden />{formatBRLFromCents(Number(c.vitrine_cents))}</span>}</span></td>
                        <td className="px-4 py-2.5 text-xs text-ledger-muted">{c.praca ?? "—"}<br />{c.representante ?? "sem representante"}</td>
                        <td className="num px-4 py-2.5 text-right">{formatInt(Number(c.vendas))}<span className="block text-xs text-ledger-muted">{formatInt(Number(c.pecas))} peças</span></td>
                        <td className="num px-4 py-2.5 text-right font-semibold text-ledger-text">{formatBRLFromCents(Number(c.valor_cents))}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Panel>
            <div className="space-y-3">
              <Panel title="Vendas por praça">
                {d.pracas.length === 0 ? <p className="text-sm text-ledger-muted">Sem vendas no período.</p> : (
                  <ul className="space-y-2.5">{d.pracas.slice(0, 12).map((x) => (
                    <li key={`${x.praca}-${x.codigo}`}>
                      <span className="flex items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate text-ledger-text">{x.codigo ? `${x.codigo} · ` : ""}{x.praca}</span><span className="num shrink-0 font-semibold">{formatBRLFromCents(Number(x.valor_cents))}</span></span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line-soft"><span className="block h-full rounded-full bg-[var(--color-bronze)]" style={{ width: `${(Number(x.valor_cents) / maxPraca) * 100}%` }} /></span>
                      <span className="text-xs text-ledger-muted">{formatInt(Number(x.vendas))} vendas · {formatInt(Number(x.consultoras))} consultoras</span>
                    </li>
                  ))}</ul>
                )}
              </Panel>
              <Panel title="Por representante">
                {d.representantes.length === 0 ? <p className="text-sm text-ledger-muted">Sem vendas no período.</p> : (
                  <ul className="divide-y divide-line-soft text-sm">{d.representantes.map((x) => (
                    <li key={x.representante} className="flex items-baseline justify-between gap-2 py-2"><span className="min-w-0 truncate">{x.representante}<span className="block text-xs text-ledger-muted">{formatInt(Number(x.consultoras))} consultoras · {formatInt(Number(x.vendas))} vendas</span></span><span className="num shrink-0 font-semibold">{formatBRLFromCents(Number(x.valor_cents))}</span></li>
                  ))}</ul>
                )}
              </Panel>
            </div>
          </div>

          <Panel title="Últimas vendas" flush>
            {d.ultimas.length === 0 ? <p className="px-6 py-5 text-sm text-ledger-muted">Sem vendas no período.</p> : (
              <ul className="divide-y divide-line-soft text-sm">{d.ultimas.map((v) => (
                <li key={v.codigo} className="flex items-center justify-between gap-3 px-6 py-2.5">
                  <span className="min-w-0"><span className="block truncate font-semibold text-ledger-text">{v.consultora} → {v.cliente}</span>
                    <span className="text-xs text-ledger-muted">{new Date(v.data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {v.codigo} · {FORMA[v.forma] ?? v.forma}{v.canal === "vitrine" ? " · vitrine" : ""}</span></span>
                  <span className="shrink-0 text-right"><span className="num block font-semibold">{formatBRLFromCents(Number(v.valor_cents))}</span>
                    <span className={cn("text-xs", v.pago ? "text-success" : "text-ledger-muted")}>{v.pago ? "pago" : "em aberto"}</span></span>
                </li>
              ))}</ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe, alerta }: { rotulo: string; valor: string; detalhe: string; alerta?: boolean }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{rotulo}</p>
      <p className={cn("num mt-1.5 font-display text-[1.7rem] font-semibold leading-none", alerta ? "text-rose-deep" : "text-ledger-text")}>{valor}</p>
      <p className="mt-1.5 text-xs text-ledger-muted">{detalhe}</p>
    </div>
  );
}

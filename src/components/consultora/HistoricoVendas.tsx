/**
 * 0180 — Menu "Histórico de vendas" da consultora: quanto vendeu e quanto ganhou de comissão, mês a mês,
 * juntando o sistema anterior e a LARDAN, e o objetivo de venda (ou meta mínima) da maleta atual.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Sparkles, Target, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { brl } from "@/lib/maletas";
import { historicoVendasQuery, mesCurto, mesLongo, porAno, ultimos12, type Objetivo } from "@/lib/historico-vendas";

const COR_VENDA = "#7A5642";
const COR_COMISSAO = "#267a58";
const dataBR = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const reaisCurto = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `${Math.round(v)}`);

function Numero({ icone: Icone, rotulo, valor, detalhe }: { icone: typeof Wallet; rotulo: string; valor: string; detalhe?: string | undefined }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="flex items-center gap-2 text-[0.95rem] text-muted-foreground"><Icone className="size-5 text-primary" aria-hidden /> {rotulo}</p>
      <strong className="mt-2 block text-[1.9rem] font-semibold leading-tight tabular-nums">{valor}</strong>
      {detalhe && <p className="mt-1 text-[0.95rem] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

/** Card do objetivo: o mesmo que sai no pedido impresso. */
export function CartaoObjetivo({ o, daMaleta }: { o: Objetivo; daMaleta: boolean }) {
  if (!o.objetivo_cents) return null;
  const meta = o.tipo === "meta";
  return (
    <section aria-label={meta ? "Meta mínima" : "Objetivo de venda"} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-[#2B201C] px-5 py-5 text-white">
        <div>
          <p className="flex items-center gap-2 text-[0.85rem] uppercase tracking-[0.18em] text-[#E9D9CC]">
            <Target className="size-4" aria-hidden /> {meta ? "Meta mínima" : "Objetivo de venda"}{daMaleta ? " · maleta atual" : ""}
          </p>
          <strong className="mt-2 block font-display text-[2.6rem] font-medium leading-none tabular-nums">{brl(o.objetivo_cents)}</strong>
        </div>
        {o.comissao_objetivo_cents != null && (
          <p className="rounded-full bg-[#267a58] px-4 py-2 text-[1.02rem] font-semibold">
            {meta ? "Vendendo isso" : "Cumprindo"}, você ganha {brl(o.comissao_objetivo_cents)}
          </p>
        )}
      </div>
      {meta ? (
        <p className="px-5 py-4 text-[1.02rem] text-muted-foreground">
          Esta é a venda mínima do ciclo para receber a próxima maleta. Depois do seu primeiro acerto, aqui aparece o seu objetivo pessoal.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-3 divide-x divide-border">
            {o.meses.slice(-3).map((m) => (
              <li key={m.mes} className="px-3 py-4 sm:px-5">
                <p className="text-[0.85rem] uppercase tracking-[0.14em] text-muted-foreground">{mesCurto(m.mes)}</p>
                {m.acerto ? (
                  <>
                    <strong className="mt-1 block text-[1.15rem] font-semibold tabular-nums">{brl(m.vendido_cents ?? 0)}</strong>
                    <p className="text-[0.9rem] text-muted-foreground">comissão {brl(m.comissao_cents ?? 0)}{m.estimada ? " (estimada)" : ""}</p>
                  </>
                ) : (
                  <p className="mt-1 text-[1rem] text-muted-foreground">sem acerto</p>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-5 py-3 text-[0.95rem] text-muted-foreground">
            {o.piso
              ? "Objetivo mínimo LARDAN."
              : o.meses_com_acerto === 1 ? "Seu melhor mês + 15%, arredondado para cima." : `Média dos seus ${o.meses_com_acerto} melhores meses + 15%, arredondada para cima.`}
            {daMaleta ? " Fica fixo até o acerto desta maleta." : ""}
          </p>
        </>
      )}
    </section>
  );
}

export function HistoricoVendas() {
  const q = useQuery(historicoVendasQuery());
  const [aberto, setAberto] = React.useState<string | null>(null);
  if (q.isLoading) return <p className="text-base text-muted-foreground">Carregando seu histórico…</p>;
  if (q.error || !q.data) return <p className="text-base text-destructive">Não foi possível carregar seu histórico agora. Tente de novo em instantes.</p>;
  const d = q.data;
  const nova = d.resumo.acertos === 0;
  const anos = porAno(d.meses);
  const grafico = ultimos12(d.meses);
  const temEstimada = d.meses.some((m) => m.estimada);

  return (
    <div className="max-w-4xl space-y-6">
      {nova ? (
        <section className="rounded-2xl border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-[1.2rem] font-semibold"><Sparkles className="size-6 text-primary" aria-hidden /> Seu histórico começa no seu primeiro acerto</p>
          <p className="mt-2 text-[1.05rem] text-muted-foreground">A cada maleta acertada, aqui aparece quanto você vendeu e quanto ganhou de comissão, mês a mês.</p>
        </section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Numero icone={TrendingUp} rotulo="Você já vendeu" valor={brl(d.resumo.vendido_cents)}
            detalhe={d.resumo.primeiro_acerto ? `desde ${dataBR(d.resumo.primeiro_acerto)}` : undefined} />
          <Numero icone={Wallet} rotulo="Você já ganhou" valor={brl(d.resumo.comissao_cents)} detalhe={`em ${d.resumo.acertos} ${d.resumo.acertos === 1 ? "acerto" : "acertos"}`} />
          {d.resumo.melhor_mes && <Numero icone={Trophy} rotulo="Seu melhor mês" valor={brl(d.resumo.melhor_mes.vendido_cents)} detalhe={mesLongo(d.resumo.melhor_mes.mes)} />}
        </div>
      )}

      {d.objetivo && <CartaoObjetivo o={d.objetivo} daMaleta={d.objetivo_da_maleta} />}

      {!nova && (
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="mb-3 text-[1.2rem] font-semibold">Últimos 12 meses</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={reaisCurto} width={48} />
                <Tooltip formatter={(v: number) => brl(Math.round(v * 100))} contentStyle={{ borderRadius: 12, background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" }} />
                <Legend wrapperStyle={{ fontSize: 14 }} />
                <Bar dataKey="vendido" name="Vendeu" fill={COR_VENDA} radius={[4, 4, 0, 0]} />
                <Bar dataKey="comissao" name="Ganhou" fill={COR_COMISSAO} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {anos.map((a) => (
        <section key={a.ano} aria-label={`Vendas de ${a.ano}`} className="overflow-hidden rounded-2xl border border-border bg-card">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted/40 px-5 py-4">
            <h2 className="text-[1.3rem] font-semibold">{a.ano}</h2>
            <p className="text-[1rem] tabular-nums">vendeu <strong>{brl(a.vendido_cents)}</strong> · ganhou <strong className="text-success">{brl(a.comissao_cents)}</strong></p>
          </header>
          <ul className="divide-y divide-border">
            {a.meses.map((m) => {
              const on = aberto === m.mes;
              return (
                <li key={m.mes}>
                  <button type="button" onClick={() => setAberto(on ? null : m.mes)} aria-expanded={on}
                    className="flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left active:bg-muted">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[1.08rem] font-semibold">{mesLongo(m.mes)}</span>
                      <span className="block text-[0.95rem] text-muted-foreground">{m.acertos} {m.acertos === 1 ? "acerto" : "acertos"}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-[1.08rem] font-semibold">{brl(m.vendido_cents)}</span>
                      <span className="block text-[0.95rem] text-success">ganhou {brl(m.comissao_cents)}{m.estimada ? "*" : ""}</span>
                    </span>
                    <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${on ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {on && (
                    <ul className="space-y-2 bg-muted/30 px-5 py-3">
                      {m.maletas.map((x) => (
                        <li key={`${x.origem}-${x.remessa}-${x.data}`} className="rounded-xl border border-border bg-card px-4 py-3">
                          <p className="flex flex-wrap justify-between gap-2 text-[1rem]">
                            <span className="font-semibold">{x.remessa ? `Remessa ${x.remessa}` : "Maleta"}{x.kits > 1 ? ` · ${x.kits} kits` : ""}</span>
                            <span className="text-muted-foreground">acerto em {dataBR(x.data)}</span>
                          </p>
                          <p className="mt-1 flex flex-wrap justify-between gap-2 text-[0.98rem] tabular-nums">
                            <span>{x.pecas_vendidas} {x.pecas_vendidas === 1 ? "peça vendida" : "peças vendidas"} · {brl(x.vendido_cents)}</span>
                            <span className="text-success">comissão {brl(x.comissao_cents)}{x.estimada ? " (estimada)" : ""}</span>
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {temEstimada && (
        <p className="text-[0.92rem] text-muted-foreground">
          * Comissão estimada: em alguns acertos do sistema anterior a comissão não ficou registrada; ela foi calculada pela tabela de comissão de hoje.
        </p>
      )}
    </div>
  );
}

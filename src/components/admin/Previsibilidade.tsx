/**
 * 0310 — Inteligência Operacional › Previsibilidade: o que deve acontecer até o fim do mês (venda, peças, paradas, novas),
 * com a conta explicada. Números só do banco (previsibilidade_painel), pelo histórico real SmallData + Lardan Cloud.
 */
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Info, Sparkles, UserMinus, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface Painel {
  mes: string; hoje: string; fim: string; dias_mes: number; dia: number;
  dados: { smalldata_ate: string | null; smalldata_ultima_remessa: string | null; maletas_historico: number; maletas_6m: number };
  venda: {
    realizado_cents: number; pipeline_cents: number; previsto_cents: number; faixa_min_cents: number; faixa_max_cents: number;
    ritmo_cents: number | null; mesmo_mes_ano_passado_cents: number | null; maletas_acertadas: number; maletas_previstas: number;
    maletas_atrasadas: number; maletas_mes_seguinte: number; maletas_smalldata: number; maletas_lardan: number; enviado_na_rua_cents: number;
    giro_rede_pct: number; giro_estreia_pct: number; pontualidade_pct: number; antecipacao_pct: number; indice_mes: number; variacao_mensal_pct: number;
  };
  pecas: { realizado: number; pipeline: number; previsto: number; faixa_min: number; faixa_max: number; ritmo: number | null; giro_rede_pct: number };
  paradas: {
    acertam_sem_proxima: number; previstas: number;
    taxas: { faixa: string; giro: string; volta_pct: number; maletas: number }[];
    risco: { nome: string; codigo: string | null; party_id: string | null; praca: string | null; representante: string | null; maletas: number;
      giro_pct: number; chance_parar_pct: number; vendido_12m_cents: number }[];
  };
  novas: { ate_agora: number; aberturas_pendentes: number; conversao_pct: number; conversao_medida: boolean; previstas: number; media_3m: number | null };
  base: { ativas_hoje: number; fim_do_mes: number };
  serie: { mes: string; vendido_cents: number; pecas: number; maletas: number; consultoras: number; novas: number }[];
}

const MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_C = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (iso: string) => `${MES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;
const rotuloMes = (iso: string) => `${MES_C[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const dataBR = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const compacto = (c: number) => { const r = c / 100; return Math.abs(r) >= 1000 ? `R$ ${(r / 1000).toFixed(r >= 10000 ? 0 : 1)} mil` : `R$ ${r.toFixed(0)}`; };
const n = (x: unknown) => Number(x ?? 0);
const MUTED = "var(--color-ledger-muted)";
const GIROS = ["zerada", "fraca", "média", "forte"];
const FAIXAS = ["1ª maleta", "2ª–3ª", "4ª ou mais"];

export function Previsibilidade() {
  const q = useQuery({
    queryKey: ["previsibilidade"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("previsibilidade_painel" as never);
      if (error) throw error;
      return data as unknown as Painel;
    },
  });
  if (q.isError) return <ErrorState message={(q.error as Error).message || "Não foi possível montar a previsão."} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return <div className="grid gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;

  const v = d.venda;
  const diasSemImportar = d.dados.smalldata_ate ? Math.floor((Date.now() - new Date(d.dados.smalldata_ate).getTime()) / 864e5) : null;
  const smalldataPesa = n(v.maletas_smalldata) > 0;
  const historicoFraco = n(d.dados.maletas_6m) < 200;
  const ritmo = v.ritmo_cents === null ? null : n(v.ritmo_cents);
  const diverge = ritmo !== null && ritmo > 0 && Math.abs(n(v.previsto_cents) - ritmo) / ritmo > 0.25;
  const grafico = [
    ...d.serie.map((s) => ({ mes: s.mes, realizado: n(s.vendido_cents), previsto: 0, atual: false })),
    { mes: d.mes, realizado: n(v.realizado_cents), previsto: Math.max(0, n(v.previsto_cents) - n(v.realizado_cents)), atual: true },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">Previsibilidade · {nomeMes(d.mes)}</p>
          <h2 className="font-display text-xl font-semibold text-ledger-text">O que deve acontecer até {dataBR(d.fim)}</h2>
        </div>
        <p className="text-xs text-ledger-muted">Dia {d.dia} de {d.dias_mes} · base: {formatInt(n(d.dados.maletas_historico))} maletas acertadas no histórico</p>
      </header>

      {(smalldataPesa && diasSemImportar !== null && diasSemImportar > 7) || historicoFraco ? (
        <div role="note" className="flex gap-3 rounded-xl border border-[var(--color-bronze)]/40 bg-[var(--color-bronze)]/10 px-4 py-3 text-sm text-ledger-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bronze" aria-hidden />
          <div>
            {smalldataPesa && diasSemImportar !== null && diasSemImportar > 7 && (
              <p><strong>{formatInt(n(v.maletas_smalldata))} das maletas que acertam este mês ainda são do SmallData</strong>, e a última importação foi há {diasSemImportar} dias ({dataBR(d.dados.smalldata_ate)}). Acertos feitos lá depois disso ainda não estão aqui: rode o extrator e importe de novo para a previsão ficar exata.</p>
            )}
            {historicoFraco && <p>Pouco histórico nos últimos 6 meses ({formatInt(n(d.dados.maletas_6m))} maletas): a faixa de erro é maior.</p>}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="ledger-panel px-5 py-4 sm:col-span-2 xl:col-span-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">Venda prevista no mês</p>
          <p className="num mt-1.5 font-display text-[2rem] font-semibold leading-none text-ledger-text">{formatBRLFromCents(n(v.previsto_cents))}</p>
          <p className="mt-1.5 text-xs text-ledger-muted">entre {formatBRLFromCents(n(v.faixa_min_cents))} e {formatBRLFromCents(n(v.faixa_max_cents))} (8 em cada 10 meses caem aqui)</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--color-success)]" style={{ width: `${Math.min(100, (n(v.realizado_cents) / Math.max(1, n(v.previsto_cents))) * 100)}%` }} />
          </div>
          <p className="mt-1 text-xs text-ledger-muted">já acertado {formatBRLFromCents(n(v.realizado_cents))} · falta {formatBRLFromCents(Math.max(0, n(v.previsto_cents) - n(v.realizado_cents)))}</p>
        </div>
        <Card icone={<Sparkles className="size-4" aria-hidden />} rotulo="Peças vendidas previstas" valor={formatInt(n(d.pecas.previsto))}
          detalhe={`entre ${formatInt(n(d.pecas.faixa_min))} e ${formatInt(n(d.pecas.faixa_max))} · já ${formatInt(n(d.pecas.realizado))}`} />
        <Card icone={<UserMinus className="size-4" aria-hidden />} rotulo="Consultoras que devem parar" valor={formatInt(n(d.paradas.previstas))} alerta={n(d.paradas.previstas) > 0}
          detalhe={`de ${formatInt(n(d.paradas.acertam_sem_proxima))} que acertam no mês sem a próxima maleta`} />
        <Card icone={<UserPlus className="size-4" aria-hidden />} rotulo="Novas consultoras previstas" valor={formatInt(n(d.novas.previstas))}
          detalhe={`${formatInt(n(d.novas.ate_agora))} já entraram · ${formatInt(n(d.novas.aberturas_pendentes))} aberturas montadas`} />
      </div>

      <div className="ledger-panel flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
        <span className="flex items-center gap-2 text-ledger-muted"><Users className="size-4" aria-hidden />Base ativa</span>
        <span className="num font-semibold text-ledger-text">{formatInt(n(d.base.ativas_hoje))} hoje</span>
        <ArrowRight className="size-4 text-ledger-muted" aria-hidden />
        <span className="num font-semibold text-ledger-text">≈ {formatInt(n(d.base.fim_do_mes))} no fim do mês</span>
        <span className="text-xs text-ledger-muted">ativa = maleta na rua ou acerto nos últimos 60 dias</span>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Venda pelo acerto · últimos 12 meses e a previsão do mês">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={MUTED} strokeOpacity={0.15} vertical={false} />
                <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={64} />
                <Tooltip formatter={(x: number, nome: string) => [formatBRLFromCents(x), nome]} labelFormatter={(x: string) => nomeMes(x)} cursor={{ fill: MUTED, fillOpacity: 0.08 }} />
                <Bar dataKey="realizado" name="Acertado" stackId="v" fill="var(--color-rose)" radius={[0, 0, 0, 0]}>
                  {grafico.map((g) => <Cell key={g.mes} fill={g.atual ? "var(--color-success)" : "var(--color-rose)"} />)}
                </Bar>
                <Bar dataKey="previsto" name="Previsto até o fim do mês" stackId="v" fill="var(--color-success)" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-ledger-muted">Mês atual: verde cheio = já acertado; verde claro = o que falta pela previsão.</p>
        </Panel>

        <Panel title="Como chegamos nesse número">
          <ol className="space-y-2.5 text-sm text-ledger-text">
            <li><strong>{formatInt(n(v.maletas_previstas))} maletas</strong> estão na rua com acerto até {dataBR(d.fim)}
              {n(v.maletas_atrasadas) > 0 && <> ({formatInt(n(v.maletas_atrasadas))} já passaram da data)</>}: {formatBRLFromCents(n(v.enviado_na_rua_cents))} em peças.
              {(n(v.maletas_smalldata) > 0 || n(v.maletas_lardan) > 0) && <span className="text-ledger-muted"> {formatInt(n(v.maletas_smalldata))} do SmallData, {formatInt(n(v.maletas_lardan))} do Lardan.</span>}</li>
            <li>Cada maleta é multiplicada pelo <strong>giro esperado da consultora</strong>: a média dela nos últimos 12 meses, puxada para a média da rede ({n(v.giro_rede_pct)}%) quando ela tem pouco histórico. Estreante usa o giro das primeiras maletas ({n(v.giro_estreia_pct)}%).</li>
            <li>Nem todo acerto acontece no dia: <strong>{n(v.pontualidade_pct)}%</strong> das maletas acertam dentro do mês previsto e {n(v.antecipacao_pct)}% das do mês seguinte acertam antes ({formatInt(n(v.maletas_mes_seguinte))} maletas).</li>
            <li>Isso dá <strong>{formatBRLFromCents(n(v.pipeline_cents))}</strong> a acertar, mais <strong>{formatBRLFromCents(n(v.realizado_cents))}</strong> já acertados ({formatInt(n(v.maletas_acertadas))} maletas).</li>
            <li>A faixa junta a incerteza de cada maleta com a variação do giro da rede de um mês para outro ({n(v.variacao_mensal_pct)}%).</li>
            <li className="rounded-lg bg-line-soft/40 px-3 py-2">
              <span className="flex items-center gap-1.5 font-semibold"><Info className="size-4 text-ledger-muted" aria-hidden />Conferência pelo ritmo</span>
              {ritmo === null ? " Sem meses suficientes para comparar." : <> Média dos 3 últimos meses × peso de {MES[Number(d.mes.slice(5, 7)) - 1]} ({n(v.indice_mes).toFixed(2)}) daria <strong>{formatBRLFromCents(ritmo)}</strong>.</>}
              {v.mesmo_mes_ano_passado_cents !== null && n(v.mesmo_mes_ano_passado_cents) > 0 && <> No mesmo mês do ano passado foram {formatBRLFromCents(n(v.mesmo_mes_ano_passado_cents))}.</>}
              {diverge && <span className="mt-1 block text-bronze">A previsão pelas maletas está mais de 25% longe do ritmo: confira se há remessa sem data de acerto ou acertos do SmallData sem importar.</span>}
            </li>
          </ol>
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Quem pode parar · acertam este mês e ainda não têm a próxima maleta" flush>
          {d.paradas.risco.length === 0 ? <p className="px-6 py-5 text-sm text-ledger-muted">Ninguém com chance relevante de parar neste mês.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-ledger-muted">
                  <th className="px-4 py-2">Consultora</th><th className="px-4 py-2">Praça · representante</th>
                  <th className="px-4 py-2 text-right">Maletas · giro</th><th className="px-4 py-2 text-right">Vendeu 12 meses</th><th className="px-4 py-2 text-right">Chance de parar</th></tr></thead>
                <tbody>{d.paradas.risco.map((c) => (
                  <tr key={(c.party_id ?? c.codigo ?? c.nome) + c.nome} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5"><span className="block font-semibold text-ledger-text">{c.nome}</span><span className="text-xs text-ledger-muted">{c.codigo ?? ""}</span></td>
                    <td className="px-4 py-2.5 text-xs text-ledger-muted">{c.praca ?? "—"}<br />{c.representante ?? "sem representante"}</td>
                    <td className="num px-4 py-2.5 text-right">{formatInt(n(c.maletas))}ª<span className="block text-xs text-ledger-muted">giro {n(c.giro_pct)}%</span></td>
                    <td className="num px-4 py-2.5 text-right">{formatBRLFromCents(n(c.vendido_12m_cents))}</td>
                    <td className="num px-4 py-2.5 text-right"><span className={cn("font-semibold", n(c.chance_parar_pct) >= 50 ? "text-rose-deep" : "text-bronze")}>{n(c.chance_parar_pct)}%</span></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="px-6 py-3 text-xs text-ledger-muted">Ordem: chance de parar × quanto ela vendeu. Ligar para as primeiras antes do acerto é onde a conversa vale mais.</p>
            </div>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel title="De onde vem a chance de parar">
            <p className="mb-2 text-xs text-ledger-muted">Quantas voltaram a pegar maleta em até 60 dias depois do acerto, no último ano.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-ledger-muted"><th className="py-1 pr-2">Maleta</th>{GIROS.map((g) => <th key={g} className="px-2 py-1 text-right">{g}</th>)}</tr></thead>
                <tbody>{FAIXAS.map((f) => (
                  <tr key={f} className="border-t border-line-soft">
                    <td className="py-1.5 pr-2 font-semibold text-ledger-text">{f}</td>
                    {GIROS.map((g) => { const t = d.paradas.taxas.find((x) => x.faixa === f && x.giro === g); return (
                      <td key={g} className="num px-2 py-1.5 text-right">{t ? <>{n(t.volta_pct)}%<span className="block text-[0.65rem] text-ledger-muted">{formatInt(n(t.maletas))}</span></> : "—"}</td>
                    ); })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Novas consultoras">
            <ul className="space-y-1.5 text-sm text-ledger-text">
              <li><strong>{formatInt(n(d.novas.ate_agora))}</strong> já receberam a primeira maleta este mês.</li>
              <li><strong>{formatInt(n(d.novas.aberturas_pendentes))}</strong> maletas de abertura estão montadas sem consultora; {d.novas.conversao_medida ? "historicamente" : "por estimativa (ainda sem histórico suficiente)"} {n(d.novas.conversao_pct)}% viram consultora.</li>
              <li>Previsão: <strong>{formatInt(n(d.novas.previstas))}</strong> novas no mês{d.novas.media_3m !== null && <> (média dos 3 últimos meses: {formatInt(n(d.novas.media_3m))})</>}.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Card({ icone, rotulo, valor, detalhe, alerta }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe: string; alerta?: boolean }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{icone}{rotulo}</p>
      <p className={cn("num mt-1.5 font-display text-[1.7rem] font-semibold leading-none", alerta ? "text-rose-deep" : "text-ledger-text")}>{valor}</p>
      <p className="mt-1.5 text-xs text-ledger-muted">{detalhe}</p>
    </div>
  );
}

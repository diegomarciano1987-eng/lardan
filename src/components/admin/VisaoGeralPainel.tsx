import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Panel, Skeleton, ErrorState, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface Painel {
  fluxo: { mes: string; entradas: number; saidas: number }[];
  agenda: { mes: string; receber: number; pagar: number }[];
  despesas_categoria: { nome: string; valor: number }[];
  estoque: { unidades: number; skus_com_saldo: number; produtos: number; publicados: number; movimentos_30d: number };
  maletas: Record<string, number>;
  asaas: {
    dias: { dia: string; entradas: number; saidas: number }[];
    cobrancas: Record<string, { n: number; valor: number }>;
  };
  rede: { total: number; ativas: number };
}

const COR = {
  entrada: "var(--color-success)",
  saida: "var(--color-rose)",
  bronze: "var(--color-bronze)",
  champagne: "var(--color-champagne)",
  asaas: "var(--color-asaas)",
  muted: "var(--color-ledger-muted)",
};
const PIZZA = ["var(--color-rose)", "var(--color-bronze)", "var(--color-champagne)", "var(--color-asaas)", "var(--color-success)", "var(--color-rose-deep)", "var(--color-ledger-muted)"];

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const compacto = (c: number) => {
  const r = c / 100;
  if (Math.abs(r) >= 1_000_000) return `R$ ${(r / 1_000_000).toFixed(1)} mi`;
  if (Math.abs(r) >= 1_000) return `R$ ${(r / 1_000).toFixed(0)} mil`;
  return `R$ ${r.toFixed(0)}`;
};

const STATUS_ASAAS: Record<string, string> = {
  PENDING: "Em aberto",
  OVERDUE: "Vencidas",
  RECEIVED: "Recebidas",
  RECEIVED_IN_CASH: "Recebidas em dinheiro",
  DUNNING_REQUESTED: "Em negativação",
  CONFIRMED: "Confirmadas",
};
const STATUS_MALETA: Record<string, string> = {
  rascunho: "Rascunho",
  montagem: "Montagem",
  conferida: "Conferida",
  expedida: "Expedida",
  transito: "Em trânsito",
  recebida: "Recebida",
  operacao: "Com a consultora",
  acerto: "Em acerto",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};

type Aba = "pulso" | "financeiro" | "operacao";

function Dica({ active, payload, label, formato }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; formato?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-ledger-text">{formato && label ? formato(label) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="num flex items-center gap-2 text-ledger-muted">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold text-ledger-text">{formatBRLFromCents(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function Kpi({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string | undefined; tom?: "asaas" | "alerta" | undefined }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className={cn("text-[0.7rem] font-semibold uppercase tracking-[0.1em]", tom === "asaas" ? "text-asaas" : "text-ledger-muted")}>{rotulo}</p>
      <p className={cn("num mt-1.5 font-display text-[1.7rem] font-semibold leading-none", tom === "alerta" ? "text-rose-deep" : "text-ledger-text")}>{valor}</p>
      {detalhe ? <p className="mt-1.5 text-xs text-ledger-muted">{detalhe}</p> : null}
    </div>
  );
}

export function VisaoGeralPainel({ saldoContas, vencidoReceber, vencidoPagar }: { saldoContas?: number | undefined; vencidoReceber?: number | undefined; vencidoPagar?: number | undefined }) {
  const [aba, setAba] = useState<Aba>("pulso");
  const q = useQuery({
    queryKey: ["painel-visao-geral"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_visao_geral" as never);
      if (error) throw error;
      return data as unknown as Painel;
    },
    staleTime: 5 * 60_000,
  });

  if (q.isError) return <ErrorState message="Não foi possível montar a visão geral." onRetry={() => void q.refetch()} />;
  const d = q.data;

  const entradas12 = d?.fluxo.reduce((s, m) => s + m.entradas, 0) ?? 0;
  const saidas12 = d?.fluxo.reduce((s, m) => s + m.saidas, 0) ?? 0;
  const mesAtual = d?.fluxo.at(-1);
  const receber6 = d?.agenda.reduce((s, m) => s + m.receber, 0) ?? 0;
  const pagar6 = d?.agenda.reduce((s, m) => s + m.pagar, 0) ?? 0;
  const asaasEnt = d?.asaas.dias.reduce((s, x) => s + x.entradas, 0) ?? 0;
  const asaasSai = d?.asaas.dias.reduce((s, x) => s + x.saidas, 0) ?? 0;
  const cob = d?.asaas.cobrancas ?? {};
  const aReceberAsaas = ["PENDING", "OVERDUE", "DUNNING_REQUESTED"].reduce((s, k) => s + (cob[k]?.valor ?? 0), 0);

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Visões do painel">
        {([
          ["pulso", "Pulso do negócio"],
          ["financeiro", "Financeiro e Asaas"],
          ["operacao", "Operação e rede"],
        ] as [Aba, string][]).map(([a, r]) => (
          <button key={a} type="button" onClick={() => setAba(a)} className={aba === a ? "admin-btn-primary text-warm-ivory" : "admin-btn"}>
            {r}
          </button>
        ))}
      </nav>

      {!d ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : aba === "pulso" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Saldo em contas" valor={saldoContas != null ? formatBRLFromCents(saldoContas) : "—"} detalhe="Todas as contas e caixas" />
            <Kpi rotulo={`Recebido em ${mesAtual ? rotuloMes(mesAtual.mes) : "—"}`} valor={formatBRLFromCents(mesAtual?.entradas ?? 0)} detalhe={`Pago no mês: ${formatBRLFromCents(mesAtual?.saidas ?? 0)}`} />
            <Kpi rotulo="Resultado de caixa · 12 meses" valor={formatBRLFromCents(entradas12 - saidas12)} detalhe={`${compacto(entradas12)} entraram · ${compacto(saidas12)} saíram`} tom={entradas12 - saidas12 < 0 ? "alerta" : undefined} />
            <Kpi rotulo="Vencido a receber" valor={formatBRLFromCents(vencidoReceber ?? 0)} detalhe={`Vencido a pagar: ${formatBRLFromCents(vencidoPagar ?? 0)}`} tom={(vencidoReceber ?? 0) > 0 ? "alerta" : undefined} />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Fluxo de caixa realizado · últimos 12 meses">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={d.fluxo} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gEnt" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COR.entrada} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COR.entrada} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gSai" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COR.saida} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={COR.saida} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ledger-muted)" strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={{ fontSize: 11, fill: COR.muted }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: COR.muted }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip content={<Dica formato={rotuloMes} />} />
                    <Area type="monotone" dataKey="entradas" name="Entradas" stroke={COR.entrada} strokeWidth={2} fill="url(#gEnt)" />
                    <Area type="monotone" dataKey="saidas" name="Saídas" stroke={COR.saida} strokeWidth={2} fill="url(#gSai)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Agenda · próximos 6 meses">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.agenda} margin={{ top: 10, right: 4, left: 4, bottom: 0 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ledger-muted)" strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={{ fontSize: 11, fill: COR.muted }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: COR.muted }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip content={<Dica formato={rotuloMes} />} cursor={{ fill: "var(--color-ledger-muted)", fillOpacity: 0.08 }} />
                    <Bar dataKey="receber" name="A receber" fill={COR.entrada} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pagar" name="A pagar" fill={COR.saida} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ledger-muted">
                A receber {formatBRLFromCents(receber6)} · a pagar {formatBRLFromCents(pagar6)} em aberto no período.
              </p>
            </Panel>
          </div>
        </>
      ) : aba === "financeiro" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Asaas · entrou em 30 dias" valor={formatBRLFromCents(asaasEnt)} tom="asaas" detalhe="Extrato Asaas" />
            <Kpi rotulo="Asaas · saiu em 30 dias" valor={formatBRLFromCents(asaasSai)} tom="asaas" detalhe="Pix, tarifas e transferências" />
            <Kpi rotulo="Cobranças Asaas a receber" valor={formatBRLFromCents(aReceberAsaas)} tom="asaas" detalhe={`${formatInt((cob["PENDING"]?.n ?? 0) + (cob["OVERDUE"]?.n ?? 0) + (cob["DUNNING_REQUESTED"]?.n ?? 0))} cobranças ainda não pagas`} />
            <Kpi rotulo="Cobranças vencidas" valor={formatBRLFromCents((cob["OVERDUE"]?.valor ?? 0) + (cob["DUNNING_REQUESTED"]?.valor ?? 0))} tom="alerta" detalhe={`${formatInt(cob["OVERDUE"]?.n ?? 0)} vencidas · ${formatInt(cob["DUNNING_REQUESTED"]?.n ?? 0)} em negativação`} />
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel title="Conta Asaas · entradas e saídas por dia (30 dias)">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.asaas.dias} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ledger-muted)" strokeOpacity={0.15} vertical={false} />
                    <XAxis dataKey="dia" tickFormatter={(x: string) => x.slice(8, 10)} tick={{ fontSize: 10, fill: COR.muted }} axisLine={false} tickLine={false} interval={2} />
                    <YAxis tickFormatter={compacto} tick={{ fontSize: 11, fill: COR.muted }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip content={<Dica formato={(x) => `${x.slice(8, 10)}/${x.slice(5, 7)}`} />} cursor={{ fill: "var(--color-ledger-muted)", fillOpacity: 0.08 }} />
                    <Bar dataKey="entradas" name="Entradas" fill={COR.asaas} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="saidas" name="Saídas" fill={COR.saida} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Despesas do ano por categoria">
              {d.despesas_categoria.length === 0 ? (
                <p className="text-sm text-ledger-muted">Sem dados.</p>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={d.despesas_categoria} dataKey="valor" nameKey="nome" innerRadius={55} outerRadius={90} paddingAngle={2} stroke="none">
                          {d.despesas_categoria.map((_, i) => (
                            <Cell key={i} fill={PIZZA[i % PIZZA.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatBRLFromCents(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="w-full space-y-1 text-xs">
                    {d.despesas_categoria.map((c, i) => (
                      <li key={c.nome} className="flex items-center gap-2">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: PIZZA[i % PIZZA.length] }} />
                        <span className="min-w-0 flex-1 truncate text-ledger-text">{c.nome}</span>
                        <span className="num text-ledger-muted">{formatBRLFromCents(c.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>
          </div>
          <Panel title="Cobranças no Asaas por situação">
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {Object.entries(cob).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
                <div key={k} className="rounded-[10px] border border-line bg-surface px-4 py-3">
                  <p className="text-xs text-ledger-muted">{STATUS_ASAAS[k] ?? k}</p>
                  <p className="num mt-1 font-semibold text-ledger-text">{formatInt(v.n)}</p>
                  <p className="num text-xs text-ledger-muted">{formatBRLFromCents(v.valor)}</p>
                </div>
              ))}
            </div>
            <Link to="/admin/financeiro/asaas" className="admin-link mt-3 inline-block">Abrir Recebíveis Asaas</Link>
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi rotulo="Peças em estoque" valor={formatInt(d.estoque.unidades)} detalhe={`${formatInt(d.estoque.skus_com_saldo)} SKUs com saldo`} />
            <Kpi rotulo="Produtos no catálogo" valor={formatInt(d.estoque.produtos)} detalhe={`${formatInt(d.estoque.movimentos_30d)} movimentos de estoque em 30 dias`} />
            <Kpi rotulo="Consultoras ativas" valor={formatInt(d.rede.ativas)} detalhe={`de ${formatInt(d.rede.total)} cadastradas`} />
            <Kpi rotulo="Inativas para reativar" valor={formatInt(d.rede.total - d.rede.ativas)} tom="alerta" detalhe="Veja por cidade na Inteligência da Rede" />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <Panel title="Rede · ativas x inativas">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { nome: "Ativas", valor: d.rede.ativas },
                        { nome: "Inativas", valor: d.rede.total - d.rede.ativas },
                      ]}
                      dataKey="valor"
                      nameKey="nome"
                      innerRadius={70}
                      outerRadius={105}
                      stroke="none"
                    >
                      <Cell fill={COR.saida} />
                      <Cell fill="var(--color-champagne-soft)" />
                    </Pie>
                    <Tooltip formatter={(v: number) => formatInt(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-center text-sm text-ledger-muted">
                {d.rede.total ? ((d.rede.ativas / d.rede.total) * 100).toFixed(1) : "0"}% da rede ativa ·{" "}
                <Link to="/admin/rede" className="admin-link">abrir mapa</Link>
              </p>
            </Panel>
            <Panel title="Maletas por etapa">
              {Object.keys(d.maletas).length === 0 ? (
                <p className="text-sm text-ledger-muted">Sem dados.</p>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={Object.entries(d.maletas).map(([k, n]) => ({ nome: STATUS_MALETA[k] ?? k, n }))}
                      margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 12, fill: COR.muted }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => formatInt(v)} cursor={{ fill: "var(--color-ledger-muted)", fillOpacity: 0.08 }} />
                      <Bar dataKey="n" name="Maletas" fill={COR.bronze} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

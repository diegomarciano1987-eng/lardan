/**
 * BI do histórico SmallData (Rede > Histórico SmallData). Só leitura.
 * Rotinas: legado_bi_* (migração 0117) via src/lib/historico-bi.ts.
 * Venda só existe em maleta ACERTADA; maleta na rua aparece à parte.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Lightbulb, Minus, Sparkles, TrendingUp } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { cn } from "@/lib/utils";
import { isoDia } from "@/lib/remessas";
import { redeMensal } from "@/lib/historico-jflex";
import {
  biAlertas,
  biInsights,
  biJornada,
  biOpcoes,
  biPainel,
  biPracaCategoria,
  biProdutos,
  biTop,
  type ConsultoraTop,
  type CriterioTop,
  type InsightBi,
  type KpisBi,
  type RecorteBi,
} from "@/lib/historico-bi";

// ------------------------------------------------------------- apoio ---
const COR = {
  bronze: "var(--color-bronze)",
  rose: "var(--color-rose)",
  roseDeep: "var(--color-rose-deep)",
  success: "var(--color-success)",
  champagne: "var(--color-champagne)",
  asaas: "var(--color-asaas)",
  info: "var(--color-info)",
  warning: "var(--color-warning)",
  muted: "var(--color-ledger-muted)",
};
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1] ?? m}/${m.slice(2, 4)}`;
const brl = formatBRLFromCents;
const compacto = (c: number) => {
  const r = c / 100;
  if (Math.abs(r) >= 1_000_000) return `R$ ${(r / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (Math.abs(r) >= 1_000) return `R$ ${(r / 1_000).toFixed(0)} mil`;
  return `R$ ${r.toFixed(0)}`;
};
const pct = (v: number | null | undefined, casas = 1) => (v === null || v === undefined ? "—" : `${v.toFixed(casas).replace(".", ",")}%`);
const dataBr = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");
const titulo = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");
const EIXO = { fontSize: 11, fill: COR.muted } as const;
const GRADE = <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ledger-muted)" strokeOpacity={0.15} vertical={false} />;

type Fmt = (v: number) => string;
/** Dica de gráfico com formato por série. */
function Dica({
  active,
  payload,
  label,
  rotulo,
  formatos,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number }[];
  label?: string | number;
  rotulo?: ((l: string) => string) | undefined;
  formatos?: Record<string, Fmt> | undefined;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-soft bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-ledger-text">{rotulo && label !== undefined ? rotulo(String(label)) : label}</p>
      {payload.map((p) => {
        const chave = String(p.dataKey ?? p.name ?? "");
        const f = formatos?.[chave];
        const v = typeof p.value === "number" ? p.value : 0;
        return (
          <p key={chave} className="num flex items-center gap-2 text-ledger-muted">
            <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
            {p.name}: <span className="font-semibold text-ledger-text">{f ? f(v) : formatInt(v)}</span>
          </p>
        );
      })}
    </div>
  );
}

function Carregando({ altura = "h-[260px]" }: { altura?: string }) {
  return <Skeleton className={cn("w-full", altura)} />;
}

function Erro({ q }: { q: { isError: boolean; error: unknown; refetch: () => unknown } }) {
  if (!q.isError) return null;
  return <ErrorState message={(q.error as Error)?.message ?? "Falha ao carregar."} onRetry={() => void q.refetch()} />;
}

function NomeConsultora({ nome, partyId }: { nome: string; partyId: string | null }) {
  return partyId ? (
    <Link to="/admin/cadastros/pessoas/$id" params={{ id: partyId }} className="admin-link">
      {nome}
    </Link>
  ) : (
    <span>{nome}</span>
  );
}

// ------------------------------------------------------------ filtros ---
type Preset = "tudo" | "12m" | "ano" | "custom";

function useRecorte() {
  const [preset, setPreset] = React.useState<Preset>("tudo");
  const [ano, setAno] = React.useState<number>(new Date().getFullYear());
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>();
  const [praca, setPraca] = React.useState("");
  const [representante, setRepresentante] = React.useState("");

  const recorte = React.useMemo<RecorteBi>(() => {
    let de: string | null = null;
    let ate: string | null = null;
    if (preset === "12m") {
      const fim = new Date();
      const ini = new Date(fim);
      ini.setFullYear(fim.getFullYear() - 1);
      ini.setDate(ini.getDate() + 1);
      de = isoDia(ini);
      ate = isoDia(fim);
    } else if (preset === "ano") {
      de = `${ano}-01-01`;
      ate = `${ano}-12-31`;
    } else if (preset === "custom") {
      de = isoDia(periodo?.from);
      ate = isoDia(periodo?.to ?? periodo?.from);
    }
    return { de, ate, praca: praca ? Number(praca) : null, representante: representante ? Number(representante) : null };
  }, [preset, ano, periodo, praca, representante]);

  return { recorte, preset, setPreset, ano, setAno, periodo, setPeriodo, praca, setPraca, representante, setRepresentante };
}

function BotaoPreset({ ativo, children, onClick }: { ativo: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        ativo ? "border-ink bg-ink text-background" : "border-line text-ledger-text hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------- insights ---
const TOM_INSIGHT: Record<InsightBi["tom"], { cls: string; Icone: typeof Lightbulb }> = {
  alerta: { cls: "border-rose/40 bg-rose/5", Icone: AlertTriangle },
  oportunidade: { cls: "border-bronze/40 bg-bronze/5", Icone: Lightbulb },
  positivo: { cls: "border-success/40 bg-success/5", Icone: TrendingUp },
  info: { cls: "border-line bg-surface", Icone: Sparkles },
};

function Insights({ recorte }: { recorte: RecorteBi }) {
  const q = useQuery({ queryKey: ["historico-bi", "insights", recorte], queryFn: () => biInsights(recorte), placeholderData: keepPreviousData });
  if (q.isLoading) return <Carregando altura="h-28" />;
  if (q.isError) return <Erro q={q} />;
  const itens = q.data ?? [];
  if (itens.length === 0) return null;
  return (
    <section aria-label="O que salta aos olhos" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {itens.map((i) => {
        const t = TOM_INSIGHT[i.tom] ?? TOM_INSIGHT.info;
        return (
          <article key={i.chave} className={cn("rounded-2xl border p-4", t.cls)}>
            <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">
              <t.Icone aria-hidden className="size-4" /> {i.titulo}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ledger-text">{i.texto}</p>
          </article>
        );
      })}
    </section>
  );
}

// --------------------------------------------------------------- KPIs ---
function Delta({ atual, anterior, inverso = false, sufixo = "%" }: { atual: number | null | undefined; anterior: number | null | undefined; inverso?: boolean; sufixo?: string }) {
  if (atual === null || atual === undefined || anterior === null || anterior === undefined || anterior === 0) return null;
  const d = sufixo === "pp" ? atual - anterior : ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(d) < 0.05) return <span className="text-xs text-ledger-muted">= período anterior</span>;
  const bom = inverso ? d < 0 : d > 0;
  const Icone = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", bom ? "text-success" : "text-rose-deep")}>
      <Icone aria-hidden className="size-3.5" />
      {d > 0 ? "+" : ""}
      {d.toFixed(1).replace(".", ",")}
      {sufixo === "pp" ? " p.p." : "%"} <span className="font-normal text-ledger-muted">vs anterior</span>
    </span>
  );
}

function Kpi({ rotulo, valor, detalhe, delta, alerta }: { rotulo: string; valor: string; detalhe?: string | undefined; delta?: React.ReactNode; alerta?: boolean }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{rotulo}</p>
      <p className={cn("num mt-1.5 font-display text-[1.6rem] font-semibold leading-none", alerta ? "text-rose-deep" : "text-ledger-text")}>{valor}</p>
      {detalhe ? <p className="mt-1.5 text-xs text-ledger-muted">{detalhe}</p> : null}
      {delta ? <p className="mt-1">{delta}</p> : null}
    </div>
  );
}

function Kpis({ k, a }: { k: KpisBi; a: KpisBi | null }) {
  return (
    <div className="space-y-3">
      {k.maletas_sem_acerto > 0 && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-ledger-text">
          {formatInt(k.maletas_sem_acerto)} maleta(s) deste recorte ainda estão sem acerto: os valores de venda do período são parciais.
          O giro (% vendido) já é confiável.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi rotulo="Valor vendido" valor={compacto(k.valor_vendido_cents)} detalhe={`${formatInt(k.pecas_vendidas)} peças`}
          delta={a ? <Delta atual={k.valor_vendido_cents} anterior={a.valor_vendido_cents} /> : null} />
        <Kpi rotulo="Giro (% vendido)" valor={pct(k.giro_pct)} detalhe={`${formatInt(k.pecas_enviadas)} peças enviadas`}
          delta={a ? <Delta atual={k.giro_pct} anterior={a.giro_pct} sufixo="pp" /> : null} />
        <Kpi rotulo="Venda por maleta" valor={k.ticket_medio_cents ? brl(k.ticket_medio_cents) : "—"}
          detalhe={`mediana ${k.ticket_mediano_cents ? brl(k.ticket_mediano_cents) : "—"}`}
          delta={a ? <Delta atual={k.ticket_medio_cents} anterior={a.ticket_medio_cents} /> : null} />
        <Kpi rotulo="Maletas acertadas" valor={formatInt(k.maletas)} detalhe={`${formatInt(k.consultoras)} consultoras · ${formatInt(k.remessas)} remessas`}
          delta={a ? <Delta atual={k.maletas} anterior={a.maletas} /> : null} />
        <Kpi rotulo="Voltaram sem venda" valor={pct(k.maletas_zeradas_pct)} detalhe={`${formatInt(k.maletas_zeradas)} maletas`} alerta={(k.maletas_zeradas_pct ?? 0) >= 25}
          delta={a ? <Delta atual={k.maletas_zeradas_pct} anterior={a.maletas_zeradas_pct} sufixo="pp" inverso /> : null} />
        <Kpi rotulo="Venda por consultora" valor={k.venda_por_consultora_cents ? brl(k.venda_por_consultora_cents) : "—"}
          detalhe={`preço médio da peça vendida ${k.preco_medio_vendido_cents ? brl(k.preco_medio_vendido_cents) : "—"} · ${k.dias_na_rua_mediana ?? "—"} dias na rua`}
          delta={a ? <Delta atual={k.venda_por_consultora_cents} anterior={a.venda_por_consultora_cents} /> : null} />
      </div>
    </div>
  );
}

// ------------------------------------------------------- top consultoras ---
const CRITERIOS: { value: CriterioTop; label: string }[] = [
  { value: "valor", label: "Valor vendido" },
  { value: "pecas", label: "Peças vendidas" },
  { value: "giro", label: "Giro (3+ maletas)" },
  { value: "ticket", label: "Venda por maleta (3+ maletas)" },
];

function Tendencia({ t }: { t: ConsultoraTop["tendencia"] }) {
  if (t === "subindo") return <ArrowUpRight aria-label="subindo" className="size-4 text-success" />;
  if (t === "caindo") return <ArrowDownRight aria-label="caindo" className="size-4 text-rose-deep" />;
  if (t === "estavel") return <Minus aria-label="estável" className="size-4 text-ledger-muted" />;
  return null;
}

function TabelaTop({ linhas, mostrarPraca }: { linhas: ConsultoraTop[]; mostrarPraca: boolean }) {
  if (linhas.length === 0) return <p className="px-6 py-5 text-sm text-ledger-muted">Sem consultoras neste recorte.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
          <tr>
            <th className="px-4 py-2.5">#</th>
            <th className="px-4 py-2.5">Consultora</th>
            {mostrarPraca && <th className="px-4 py-2.5">Praça</th>}
            <th className="px-4 py-2.5 text-right">Maletas</th>
            <th className="px-4 py-2.5 text-right">Vendidas</th>
            <th className="px-4 py-2.5 text-right">Giro</th>
            <th className="px-4 py-2.5 text-right">Valor</th>
            <th className="px-4 py-2.5 text-right">Por maleta</th>
            <th className="px-4 py-2.5">Forte em</th>
            <th className="px-4 py-2.5" title="Giro das 3 últimas maletas comparado com as anteriores">Ritmo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((c) => (
            <tr key={`${c.praca ?? 0}-${c.codcli}`} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2.5 tabular-nums text-ledger-muted">{c.posicao}</td>
              <td className="px-4 py-2.5 font-medium text-ledger-text">
                <NomeConsultora nome={c.nome} partyId={c.party_id} />
                <span className="block text-xs font-normal text-ledger-muted">{[c.cidade, c.uf].filter(Boolean).join("/")}</span>
              </td>
              {mostrarPraca && <td className="px-4 py-2.5 text-ledger-muted">{titulo(c.praca_nome)}</td>}
              <td className="px-4 py-2.5 text-right tabular-nums">{c.maletas}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatInt(c.pecas_vendidas)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{pct(c.giro_pct)}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{brl(c.valor_vendido_cents)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{c.ticket_medio_cents ? brl(c.ticket_medio_cents) : "—"}</td>
              <td className="px-4 py-2.5 text-ledger-muted">{titulo(c.categoria_mais_vendida)}</td>
              <td className="px-4 py-2.5" title={`últimas 3: ${pct(c.giro_recente_pct)} · antes: ${pct(c.giro_antes_pct)}`}>
                <Tendencia t={c.tendencia} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopConsultoras({ recorte, pracas }: { recorte: RecorteBi; pracas: { codigo: number; nome: string }[] }) {
  const [modo, setModo] = React.useState<"geral" | "praca">("geral");
  const [criterio, setCriterio] = React.useState<CriterioTop>("valor");
  const [pracaSel, setPracaSel] = React.useState<string>("");

  const geral = useQuery({
    queryKey: ["historico-bi", "top", recorte, criterio],
    queryFn: () => biTop(recorte, { criterio, limite: 10 }),
    enabled: modo === "geral",
    placeholderData: keepPreviousData,
  });
  const porPraca = useQuery({
    queryKey: ["historico-bi", "top-praca", recorte, criterio],
    queryFn: () => biTop(recorte, { criterio, porPraca: true, limite: 10 }),
    enabled: modo === "praca",
    placeholderData: keepPreviousData,
  });

  const grupos = React.useMemo(() => {
    const m = new Map<number, ConsultoraTop[]>();
    for (const c of porPraca.data ?? []) {
      const k = c.praca ?? 0;
      const lista = m.get(k) ?? [];
      lista.push(c);
      m.set(k, lista);
    }
    return m;
  }, [porPraca.data]);
  const pracasComDados = pracas.filter((p) => grupos.has(p.codigo));
  const pracaAtiva = pracaSel ? Number(pracaSel) : (recorte.praca ?? pracasComDados[0]?.codigo ?? 0);
  const q = modo === "geral" ? geral : porPraca;

  return (
    <Panel
      title="Top 10 consultoras"
      flush
      action={
        <div className="flex flex-wrap items-center gap-2">
          <BotaoPreset ativo={modo === "geral"} onClick={() => setModo("geral")}>Geral</BotaoPreset>
          <BotaoPreset ativo={modo === "praca"} onClick={() => setModo("praca")}>Por praça</BotaoPreset>
          <div className="w-56">
            <SmartSelect value={criterio} onChange={(v) => setCriterio(v as CriterioTop)} options={CRITERIOS} />
          </div>
        </div>
      }
    >
      {modo === "praca" && pracasComDados.length > 0 && (
        <div className="border-b border-line-soft px-4 py-3">
          <div className="w-72">
            <SmartSelect
              value={String(pracaAtiva)}
              onChange={setPracaSel}
              options={pracasComDados.map((p) => ({ value: String(p.codigo), label: titulo(p.nome) }))}
            />
          </div>
        </div>
      )}
      {q.isLoading && <div className="space-y-2 p-6"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
      {q.isError && <div className="p-6"><Erro q={q} /></div>}
      {!q.isLoading && !q.isError && (
        modo === "geral"
          ? <TabelaTop linhas={geral.data ?? []} mostrarPraca />
          : <TabelaTop linhas={grupos.get(pracaAtiva) ?? []} mostrarPraca={false} />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ gráficos ---
function EvolucaoMensal({ recorte }: { recorte: RecorteBi }) {
  const q = useQuery({
    queryKey: ["historico-bi", "mensal", recorte],
    queryFn: () => redeMensal({ de: recorte.de ?? null, ate: recorte.ate ?? null, praca: recorte.praca ?? null, representante: recorte.representante ?? null }),
    placeholderData: keepPreviousData,
  });
  const dados = (q.data ?? []).map((m) => ({ mes: m.mes, valor: m.valor_vendido_cents ?? 0, giro: m.giro_pct ?? 0, maletas: m.maletas }));
  return (
    <Panel title="Valor vendido e giro por mês de saída">
      {q.isLoading ? <Carregando /> : q.isError ? <Erro q={q} /> : dados.length === 0 ? <p className="text-sm text-ledger-muted">Sem dados.</p> : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              {GRADE}
              <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={EIXO} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis yAxisId="v" tickFormatter={compacto} tick={EIXO} axisLine={false} tickLine={false} width={70} />
              <YAxis yAxisId="g" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<Dica rotulo={rotuloMes} formatos={{ valor: brl, giro: (v) => pct(v), maletas: formatInt }} />}
                cursor={{ fill: "var(--color-ledger-muted)", fillOpacity: 0.08 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="v" dataKey="valor" name="Valor vendido" fill={COR.bronze} radius={[4, 4, 0, 0]} />
              <Line yAxisId="g" type="monotone" dataKey="giro" name="Giro" stroke={COR.roseDeep} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-2 text-xs text-ledger-muted">Meses recentes ainda têm maletas na rua: o valor sobe conforme os acertos entram.</p>
    </Panel>
  );
}

// -------------------------------------------------------- mapa de calor ---
function corIndice(i: number | null | undefined) {
  if (i === null || i === undefined) return "transparent";
  if (i >= 1.3) return "color-mix(in oklab, var(--color-success) 45%, transparent)";
  if (i >= 1.1) return "color-mix(in oklab, var(--color-success) 22%, transparent)";
  if (i <= 0.7) return "color-mix(in oklab, var(--color-rose) 45%, transparent)";
  if (i <= 0.9) return "color-mix(in oklab, var(--color-rose) 22%, transparent)";
  return "transparent";
}

function MapaPracaCategoria({ recorte }: { recorte: RecorteBi }) {
  const q = useQuery({
    queryKey: ["historico-bi", "praca-categoria", recorte.de, recorte.ate, recorte.representante],
    queryFn: () => biPracaCategoria(recorte),
    placeholderData: keepPreviousData,
  });
  const cats = (q.data?.categorias ?? []).slice(0, 8);
  const linhas = q.data?.linhas ?? [];
  return (
    <Panel title="Onde cada categoria gira melhor (praça × categoria)" flush>
      {q.isLoading ? <div className="p-6"><Carregando /></div> : q.isError ? <div className="p-6"><Erro q={q} /></div> : linhas.length === 0 ? (
        <p className="px-6 py-5 text-sm text-ledger-muted">Sem dados.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                <tr>
                  <th className="px-4 py-2.5">Praça</th>
                  {cats.map((c) => (
                    <th key={c} className="px-3 py-2.5 text-right">
                      {titulo(c)}
                      <span className="block font-normal normal-case tracking-normal">rede {pct(q.data?.giro_rede?.[c])}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.praca} className={cn("border-b border-line-soft last:border-0", recorte.praca === l.praca && "font-semibold")}>
                    <td className="px-4 py-2 text-ledger-text">{titulo(l.praca_nome)}</td>
                    {cats.map((c) => {
                      const cel = l.celulas?.[c];
                      return (
                        <td key={c} className="px-3 py-2 text-right tabular-nums" style={{ background: corIndice(cel?.indice) }}
                          title={cel ? `giro ${pct(cel.giro_pct)} · ${pct(cel.envio_pct)} do envio da praça · ${cel.indice ?? "—"}× a rede` : "pouco volume"}>
                          {cel ? pct(cel.giro_pct) : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-6 py-3 text-xs text-ledger-muted">
            Verde: a praça vende essa categoria acima da rede (mande mais). Rosa: abaixo (mande menos ou troque o modelo).
          </p>
        </>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ alertas ---
function ListaAlerta<T extends { codcli: number; party_id: string | null; nome: string }>({
  titulo: t,
  descricao,
  itens,
  detalhe,
  tom,
}: {
  titulo: string;
  descricao: string;
  itens: T[];
  detalhe: (i: T) => string;
  tom: "alerta" | "oportunidade" | "positivo";
}) {
  return (
    <div className={cn("rounded-2xl border p-4", tom === "alerta" ? "border-rose/40" : tom === "positivo" ? "border-success/40" : "border-bronze/40")}>
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{t}</p>
      <p className="mt-1 text-xs text-ledger-muted">{descricao}</p>
      {itens.length === 0 ? (
        <p className="mt-3 text-sm text-ledger-muted">Ninguém neste recorte.</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
          {itens.map((i) => (
            <li key={i.codcli} className="flex flex-col">
              <span className="font-medium text-ledger-text"><NomeConsultora nome={i.nome} partyId={i.party_id} /></span>
              <span className="text-xs text-ledger-muted">{detalhe(i)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alertas({ recorte }: { recorte: RecorteBi }) {
  const q = useQuery({
    queryKey: ["historico-bi", "alertas", recorte.praca, recorte.representante],
    queryFn: () => biAlertas(recorte, 30),
    placeholderData: keepPreviousData,
  });
  const a = q.data;
  return (
    <Panel title="Quem precisa de atenção agora">
      {q.isLoading ? <Carregando altura="h-48" /> : q.isError ? <Erro q={q} /> : !a ? null : (
        <>
          <p className="mb-3 text-sm text-ledger-muted">
            Referência: últimas maletas registradas até {dataBr(a.hoje)} · giro da rede {pct(a.giro_rede_pct)}.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ListaAlerta
              titulo={`Zeraram 2 seguidas (${formatInt(a.zeraram_duas.consultoras)})`}
              descricao={`${formatInt(a.zeraram_duas.com_maleta_na_rua)} ainda estão com maleta na rua: ${formatInt(a.zeraram_duas.pecas_na_rua)} peças.`}
              itens={a.zeraram_duas.lista}
              detalhe={(i) => `${titulo(i.praca_nome)} · última ${dataBr(i.ultima_maleta)}${i.pecas_na_rua ? ` · ${formatInt(i.pecas_na_rua)} peças na rua` : ""}`}
              tom="alerta"
            />
            <ListaAlerta
              titulo="Em queda"
              descricao="Vendiam bem e o giro das 3 últimas maletas caiu pela metade ou mais."
              itens={a.em_queda}
              detalhe={(i) => `${titulo(i.praca_nome)} · de ${pct(i.giro_antes_pct)} para ${pct(i.giro_recente_pct)}`}
              tom="alerta"
            />
            <ListaAlerta
              titulo="Boas que sumiram"
              descricao="Entre as 20% que mais venderam e sem maleta há mais de 120 dias."
              itens={a.sumiram}
              detalhe={(i) => `${brl(i.valor_vendido_cents)} vendidos · giro ${pct(i.giro_pct)} · ${i.dias_sem_maleta} dias sem maleta`}
              tom="oportunidade"
            />
            <ListaAlerta
              titulo="Estreantes fortes"
              descricao="Na 1ª maleta, nos últimos 6 meses, venderam o dobro do giro da praça."
              itens={a.estreantes}
              detalhe={(i) => `${titulo(i.praca_nome)} · giro ${pct(i.giro_pct)} · ${brl(i.valor_vendido_cents)}`}
              tom="positivo"
            />
          </div>
        </>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ produtos ---
function Produtos({ recorte }: { recorte: RecorteBi }) {
  const q = useQuery({ queryKey: ["historico-bi", "produtos", recorte], queryFn: () => biProdutos(recorte, null, 20), placeholderData: keepPreviousData });
  const itens = q.data ?? [];
  return (
    <Panel title="Peças que mais vendem" flush>
      {q.isLoading ? <div className="p-6"><Carregando altura="h-40" /></div> : q.isError ? <div className="p-6"><Erro q={q} /></div> : itens.length === 0 ? (
        <p className="px-6 py-5 text-sm text-ledger-muted">Sem dados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-4 py-2.5">Peça</th>
                <th className="px-4 py-2.5">Categoria</th>
                <th className="px-4 py-2.5 text-right">Vendidas</th>
                <th className="px-4 py-2.5 text-right">Valor</th>
                <th className="px-4 py-2.5 text-right">Consultoras</th>
                <th className="px-4 py-2.5 text-right" title="Últimos 90 dias de acerto comparados com os 90 anteriores">90 dias</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((p) => {
                const sobe = p.ultimos_90d > p.anteriores_90d;
                const cai = p.ultimos_90d < p.anteriores_90d;
                return (
                  <tr key={p.produto} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ledger-text">
                      {p.nome ?? `Produto ${p.produto}`}
                      <span className="block text-xs font-normal text-ledger-muted">{p.referencia ?? ""}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ledger-muted">{titulo(p.categoria)}{p.subcategoria ? ` · ${titulo(p.subcategoria)}` : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatInt(p.quantidade)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{brl(p.valor_cents)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInt(p.consultoras)}</td>
                    <td className={cn("px-4 py-2.5 text-right tabular-nums", sobe ? "text-success" : cai ? "text-rose-deep" : "text-ledger-muted")}>
                      {formatInt(p.ultimos_90d)} {sobe ? "▲" : cai ? "▼" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- tela ---
export function BiHistorico() {
  const f = useRecorte();
  const { recorte } = f;

  const opcoes = useQuery({ queryKey: ["historico-bi", "opcoes"], queryFn: biOpcoes, staleTime: 10 * 60_000 });
  const painel = useQuery({ queryKey: ["historico-bi", "painel", recorte], queryFn: () => biPainel(recorte), placeholderData: keepPreviousData });
  const jornada = useQuery({ queryKey: ["historico-bi", "jornada", recorte], queryFn: () => biJornada(recorte), placeholderData: keepPreviousData });

  const anos = React.useMemo(() => {
    const de = opcoes.data?.periodo.de;
    const ate = opcoes.data?.periodo.ate;
    if (!de || !ate) return [] as number[];
    const lista: number[] = [];
    for (let y = Number(ate.slice(0, 4)); y >= Number(de.slice(0, 4)); y--) lista.push(y);
    return lista;
  }, [opcoes.data]);

  const p = painel.data;
  const j = jornada.data;

  if (painel.isError && !p) return <Erro q={painel} />;
  if (!painel.isLoading && p && p.kpis.maletas === 0 && !recorte.de && !recorte.praca && !recorte.representante) {
    return <EmptyState title="Nenhum histórico importado ainda" description="Importe os arquivos do SmallData em Configurações > Histórico." />;
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="ledger-panel space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <BotaoPreset ativo={f.preset === "tudo"} onClick={() => f.setPreset("tudo")}>Todo o histórico</BotaoPreset>
          <BotaoPreset ativo={f.preset === "12m"} onClick={() => f.setPreset("12m")}>Últimos 12 meses</BotaoPreset>
          {anos.map((y) => (
            <BotaoPreset key={y} ativo={f.preset === "ano" && f.ano === y} onClick={() => { f.setAno(y); f.setPreset("ano"); }}>{y}</BotaoPreset>
          ))}
          <BotaoPreset ativo={f.preset === "custom"} onClick={() => f.setPreset("custom")}>Outro período</BotaoPreset>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {f.preset === "custom" && (
            <label className="grid gap-1.5 text-sm">
              <span className="ledger-eyebrow">Período (saída da maleta)</span>
              <DateRangeField value={f.periodo} onChange={f.setPeriodo} placeholder="Escolha o período" />
            </label>
          )}
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Praça</span>
            <SmartSelect value={f.praca} onChange={f.setPraca} placeholder="Todas as praças"
              options={[{ value: "", label: "Todas as praças" }, ...(opcoes.data?.pracas ?? []).map((x) => ({ value: String(x.codigo), label: titulo(x.nome) }))]} />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="ledger-eyebrow">Representante</span>
            <SmartSelect value={f.representante} onChange={f.setRepresentante} placeholder="Todos"
              options={[{ value: "", label: "Todos os representantes" }, ...(opcoes.data?.representantes ?? []).map((x) => ({ value: String(x.codigo), label: x.nome }))]} />
          </label>
        </div>
      </div>

      <Insights recorte={recorte} />

      {painel.isLoading && !p ? <Carregando altura="h-28" /> : p ? <Kpis k={p.kpis} a={p.anterior} /> : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <EvolucaoMensal recorte={recorte} />
        <Panel title="Quanto cada maleta vende (% das peças)">
          {!p ? <Carregando /> : (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={p.distribuicao} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                  {GRADE}
                  <XAxis dataKey="faixa" tick={EIXO} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatInt} tick={EIXO} axisLine={false} tickLine={false} width={50} />
                  <Tooltip content={<Dica formatos={{ maletas: formatInt }} />} cursor={{ fill: "var(--color-ledger-muted)", fillOpacity: 0.08 }} />
                  <Bar dataKey="maletas" name="Maletas" radius={[4, 4, 0, 0]}>
                    {p.distribuicao.map((d) => (
                      <Cell key={d.faixa} fill={d.ordem === 0 ? COR.rose : d.ordem >= 4 ? COR.success : COR.bronze} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {p && (
            <p className="mt-2 text-xs text-ledger-muted">
              {p.distribuicao.map((d) => `${d.faixa}: ${pct(d.pct)}`).join(" · ")}. Só maletas com 10+ peças.
            </p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <TopConsultoras recorte={recorte} pracas={opcoes.data?.pracas ?? []} />
        <Panel title="Concentração da venda">
          {!p ? <Carregando /> : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([["10%", p.pareto.top10_pct], ["20%", p.pareto.top20_pct], ["50%", p.pareto.top50_pct]] as const).map(([r, v]) => (
                  <div key={r} className="rounded-xl bg-surface-muted px-2 py-3">
                    <p className="num font-display text-2xl font-semibold text-ledger-text">{pct(v)}</p>
                    <p className="text-xs text-ledger-muted">da venda vem das {r} melhores</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[{ consultoras_pct: 0, venda_pct: 0 }, ...p.pareto.curva]} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                    {GRADE}
                    <XAxis dataKey="consultoras_pct" tickFormatter={(v: number) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} width={40} domain={[0, 100]} />
                    <Tooltip content={<Dica rotulo={(l) => `${l}% das consultoras`} formatos={{ venda_pct: (v) => pct(v) }} />} />
                    <Area type="monotone" dataKey="venda_pct" name="da venda" stroke={COR.bronze} strokeWidth={2} fill={COR.champagne} fillOpacity={0.35} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Jornada: como a consultora vende da 1ª à 12ª maleta">
          {!j ? <Carregando /> : (
            <>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={j.curva.map((c) => ({ ...c, rotulo: c.n >= 12 ? "12ª+" : `${c.n}ª` }))} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                    {GRADE}
                    <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="n" tickFormatter={formatInt} tick={EIXO} axisLine={false} tickLine={false} width={50} />
                    <YAxis yAxisId="p" orientation="right" tickFormatter={(v: number) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<Dica formatos={{ consultoras: formatInt, giro_pct: (v) => pct(v), voltou_pct: (v) => pct(v) }} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="n" dataKey="consultoras" name="Consultoras" fill={COR.champagne} radius={[4, 4, 0, 0]} />
                    <Line yAxisId="p" type="monotone" dataKey="giro_pct" name="Giro" stroke={COR.roseDeep} strokeWidth={2} />
                    <Line yAxisId="p" type="monotone" dataKey="voltou_pct" name="Pegou a próxima" stroke={COR.success} strokeWidth={2} strokeDasharray="4 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {j.primeira_maleta.map((x) => (
                  <div key={String(x.zerada)} className={cn("rounded-xl px-3 py-2 text-sm", x.zerada ? "bg-rose/10" : "bg-success/10")}>
                    <p className="font-semibold text-ledger-text">{x.zerada ? "1ª maleta sem venda" : "1ª maleta com venda"}</p>
                    <p className="text-xs text-ledger-muted">
                      {formatInt(x.consultoras)} consultoras · {pct(x.recebeu_segunda_pct)} pegaram a 2ª · 2ª girou {pct(x.giro_segunda_pct)}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
        <Panel title="Rede: consultoras ativas, que entraram e que pararam (por trimestre)">
          {!j ? <Carregando /> : (
            <>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={j.trimestres} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                    {GRADE}
                    <XAxis dataKey="trimestre" tick={EIXO} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatInt} tick={EIXO} axisLine={false} tickLine={false} width={50} />
                    <Tooltip content={<Dica formatos={{ ativas: formatInt, novas: formatInt, pararam: formatInt }} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="novas" name="Entraram" fill={COR.success} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pararam" name="Pararam" fill={COR.rose} radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="ativas" name="Ativas no trimestre" stroke={COR.bronze} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ledger-muted">
                "Parou" = última maleta antes de {dataBr(j.corte_parou)} (120 dias sem nova maleta). Das que pararam:{" "}
                {j.parou_apos.slice(0, 4).map((x) => `${formatInt(x.consultoras)} após a ${x.n}ª`).join(" · ")}.
              </p>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Mix: quanto vai na maleta × quanto vende">
          {!p ? <Carregando /> : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={p.mix.filter((m) => m.envio_pct >= 0.5)} margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-ledger-muted)" strokeOpacity={0.15} horizontal={false} />
                  <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={EIXO} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="categoria" tickFormatter={(v: string) => titulo(v)} tick={EIXO} axisLine={false} tickLine={false} width={96} />
                  <Tooltip content={<Dica rotulo={(l) => titulo(l)} formatos={{ envio_pct: (v) => pct(v), venda_pct: (v) => pct(v) }} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="envio_pct" name="% do envio" fill={COR.champagne} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="venda_pct" name="% da venda" fill={COR.bronze} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {p && (
            <p className="mt-2 text-xs text-ledger-muted">
              Giro por categoria: {p.mix.filter((m) => m.envio_pct >= 0.5).map((m) => `${titulo(m.categoria)} ${pct(m.giro_pct)}`).join(" · ")}.
              Quando a barra de venda passa a de envio, a categoria merece mais espaço na maleta.
            </p>
          )}
        </Panel>
        <div className="grid gap-3">
          <Panel title="Tamanho da maleta × giro">
            {!p ? <Carregando altura="h-[120px]" /> : (
              <div className="h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={p.tamanho} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="faixa" tick={EIXO} axisLine={false} tickLine={false} tickFormatter={(v: string) => `${v} pç`} />
                    <YAxis hide />
                    <Tooltip content={<Dica rotulo={(l) => `${l} peças`} formatos={{ giro_pct: (v) => pct(v), ticket_medio_cents: brl }} />} />
                    <Bar dataKey="giro_pct" name="Giro" fill={COR.bronze} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-1 text-xs text-ledger-muted">Maleta grande vai para quem já vende: compare dentro do mesmo perfil antes de concluir.</p>
          </Panel>
          <Panel title="Dias na rua × giro">
            {!p ? <Carregando altura="h-[120px]" /> : (
              <div className="h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={p.dias_na_rua} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="faixa" tick={EIXO} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip content={<Dica formatos={{ giro_pct: (v) => pct(v) }} />} />
                    <Bar dataKey="giro_pct" name="Giro" fill={COR.asaas} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
          <Panel title="Sazonalidade: giro por mês de saída">
            {!p ? <Carregando altura="h-[120px]" /> : (
              <div className="h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={p.sazonalidade.map((s) => ({ ...s, rotulo: MES[s.mes - 1] ?? String(s.mes) }))} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip content={<Dica formatos={{ giro_pct: (v) => pct(v) }} />} />
                    <Bar dataKey="giro_pct" name="Giro" radius={[4, 4, 0, 0]}>
                      {p.sazonalidade.map((s) => (
                        <Cell key={s.mes} fill={(s.giro_pct ?? 0) >= (p.kpis.giro_pct ?? 0) ? COR.success : COR.champagne} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <MapaPracaCategoria recorte={recorte} />

      <Alertas recorte={recorte} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Produtos recorte={recorte} />
        <Panel title="Ano a ano" flush>
          {!p ? <div className="p-6"><Carregando altura="h-40" /></div> : (
            <table className="w-full text-sm">
              <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                <tr>
                  <th className="px-4 py-2.5">Ano</th>
                  <th className="px-4 py-2.5 text-right">Maletas</th>
                  <th className="px-4 py-2.5 text-right">Consultoras</th>
                  <th className="px-4 py-2.5 text-right">Giro</th>
                  <th className="px-4 py-2.5 text-right">Valor</th>
                  <th className="px-4 py-2.5 text-right">Por maleta</th>
                </tr>
              </thead>
              <tbody>
                {p.anos.map((a) => (
                  <tr key={a.ano} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-medium">{a.ano}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInt(a.maletas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatInt(a.consultoras)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{pct(a.giro_pct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{compacto(a.valor_vendido_cents)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{a.ticket_medio_cents ? brl(a.ticket_medio_cents) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

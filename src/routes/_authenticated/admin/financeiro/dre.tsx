import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, FileText, Lock, Unlock, Upload } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { useCapabilities, can } from "@/lib/capabilities";
import { fetchClassificacoes, fetchFinDre, fetchFinDreDetalhe } from "@/lib/financeiro";
import {
  fecharPeriodo,
  fetchDreGerencial,
  fetchPeriodos,
  fimDoMes,
  mapearConta,
  nomeMes,
  reabrirPeriodo,
  salvarOrcamento,
  type Comparativo,
  type DreGerencial,
  type DreLinhaG,
  type FiltrosDreGerencial,
} from "@/lib/dre-gerencial";

interface Busca {
  de?: string;
  ate?: string;
  regime?: string;
  centro?: string;
  entidade?: string;
  comp?: string;
  modo?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/dre")({
  component: DreGerencialTela,
  validateSearch: (s: Record<string, unknown>): Busca => {
    const o: Busca = {};
    for (const k of ["de", "ate", "regime", "centro", "entidade", "comp", "modo"] as const)
      if (typeof s[k] === "string") o[k] = s[k] as string;
    return o;
  },
});

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const hojeSP = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
const addMeses = (ymStr: string, n: number) => {
  const d = new Date(Number(ymStr.slice(0, 4)), Number(ymStr.slice(5, 7)) - 1 + n, 1);
  return ym(d);
};
const pct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const variacaoPct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);

const ROTULO_CASCATA: Record<string, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções",
  cmv: "CMV",
  comerciais: "Comerciais",
  perdas: "Perdas",
  administrativas: "Administrativas",
  financeiro: "Financeiro",
  depreciacao_ir: "Deprec./IR",
  fora_estrutura: "Fora da estrutura",
};

type Origem = { titulo: string; mesDe: string; mesAte: string; contas: { chart_id: string; nome: string }[] } | null;

function DreGerencialTela() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  const caps = useCapabilities();
  const qc = useQueryClient();
  const atual = ym(hojeSP());
  const deYm = (s.de ?? `${atual}-01`).slice(0, 7);
  const ateYm = (s.ate ?? fimDoMes(atual)).slice(0, 7);
  const regime: "competencia" | "caixa" = s.regime === "caixa" ? "caixa" : "competencia";
  const comp: Comparativo = s.comp === "ano_anterior" || s.comp === "orcado" ? s.comp : "mes_anterior";
  const modo = s.modo === "pct" || s.modo === "var" ? s.modo : "valor";
  const [abertos, setAbertos] = React.useState<Set<string>>(new Set());
  const [foco, setFoco] = React.useState<string | null>(null);
  const [origem, setOrigem] = React.useState<Origem>(null);
  const [pendAberto, setPendAberto] = React.useState(false);

  const filtros: FiltrosDreGerencial = {
    de: `${deYm}-01`,
    ate: fimDoMes(ateYm),
    regime,
    comparativo: comp,
    ...(s.centro ? { centro_custo_id: s.centro } : {}),
    ...(s.entidade ? { entidade_id: s.entidade } : {}),
  };
  const filtrosSpark: FiltrosDreGerencial = { ...filtros, de: `${addMeses(ateYm, -11)}-01`, comparativo: "mes_anterior" };

  const q = useQuery({ queryKey: ["fin-dre-gerencial", filtros], queryFn: () => fetchDreGerencial(filtros) });
  const spark = useQuery({ queryKey: ["fin-dre-gerencial", "spark", filtrosSpark], queryFn: () => fetchDreGerencial(filtrosSpark) });
  const pend = useQuery({
    queryKey: ["fin-dre", "pend", filtros],
    queryFn: () =>
      fetchFinDre({
        de: filtros.de,
        ate: filtros.ate,
        regime,
        ...(s.centro ? { centro_custo_id: s.centro } : {}),
        ...(s.entidade ? { entidade_id: s.entidade } : {}),
      }),
  });
  const classif = useQuery({ queryKey: ["fin-classificacoes", "dre"], queryFn: () => fetchClassificacoes({}), staleTime: 60_000 });

  const trocar = (patch: Partial<Busca>) =>
    void navigate({ to: "/admin/financeiro/dre", search: (prev: Busca) => ({ ...prev, ...patch }), replace: true });
  const atalho = (de: string, ate: string) => trocar({ de: `${de}-01`, ate: fimDoMes(ate) });

  const d = q.data;
  const linha = (c: string) => d?.linhas.find((l) => l.codigo === c);
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["fin-dre-gerencial"] });

  const abrirOrigem = (l: DreLinhaG, mes: string | null) => {
    if (!d) return;
    const grupos = l.tipo === "grupo" ? [l] : d.linhas.filter((x) => x.tipo === "grupo" && x.ordem < l.ordem);
    const contas = grupos.flatMap((g) => g.contas.map((c) => ({ chart_id: c.chart_id, nome: `${c.codigo} · ${c.nome}` })));
    setOrigem({
      titulo: `${l.rotulo.replace(/^[=(−+/) ]+/, "")} · ${mes ? nomeMes(mes, false) : "período"}`,
      mesDe: mes ?? d.meses[0]!,
      mesAte: mes ?? d.meses[d.meses.length - 1]!,
      contas,
    });
  };

  return (
    <AreaFinanceiraGuard capacidade="finance.dre.view">
      <div className="space-y-6">
        <Panel title="DRE gerencial">
          <div className="flex flex-wrap items-center gap-2">
            {[
              ["Mês", atual, atual],
              ["Trimestre", addMeses(atual, -2), atual],
              ["Ano", `${atual.slice(0, 4)}-01`, `${atual.slice(0, 4)}-12`],
              ["Últimos 12 meses", addMeses(atual, -11), atual],
            ].map(([rot, a, b]) => (
              <button
                key={rot}
                type="button"
                className={`admin-btn ${deYm === a && ateYm === b ? "admin-btn-primary" : ""}`}
                onClick={() => atalho(a!, b!)}
              >
                {rot}
              </button>
            ))}
            <DateRangeField
              value={{ from: new Date(`${deYm}-01T12:00:00`), to: new Date(`${fimDoMes(ateYm)}T12:00:00`) }}
              onChange={(r) => r?.from && r.to && atalho(ym(r.from), ym(r.to))}
              className="w-64"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SmartSelect
              options={[
                { value: "competencia", label: "Regime de competência" },
                { value: "caixa", label: "Regime de caixa" },
              ]}
              value={regime}
              onChange={(v) => trocar({ regime: v })}
              className="w-56"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todas as empresas" },
                ...(classif.data?.entidades ?? []).map((e) => ({ value: e.id, label: e.nome })),
              ]}
              value={s.entidade ?? ""}
              onChange={(v) => trocar({ entidade: v })}
              className="w-56"
            />
            <SmartSelect
              options={[
                { value: "", label: "Todos os centros de custo" },
                ...(classif.data?.centros ?? []).map((c) => ({ value: c.id, label: `${c.codigo} · ${c.nome}` })),
              ]}
              value={s.centro ?? ""}
              onChange={(v) => trocar({ centro: v })}
              className="w-60"
            />
            <SmartSelect
              options={[
                { value: "mes_anterior", label: "Comparar com mês anterior" },
                { value: "ano_anterior", label: "Comparar com ano anterior" },
                { value: "orcado", label: "Comparar com orçado" },
              ]}
              value={comp}
              onChange={(v) => trocar({ comp: v })}
              className="w-60"
            />
            <div className="ml-auto flex gap-2">
              <button type="button" className="admin-btn" disabled={!d} onClick={() => d && exportarExcel(d)}>
                <Download className="size-4" /> Excel
              </button>
              <button type="button" className="admin-btn" disabled={!d} onClick={() => d && exportarPdf(d, regime)}>
                <FileText className="size-4" /> PDF diretoria
              </button>
              <Link to="/admin/financeiro/dre-simples" className="admin-btn">
                DRE simples
              </Link>
            </div>
          </div>
          <p className="mt-3 text-xs font-medium text-ledger-muted">
            Apuração gerencial interna, com a mesma regra da DRE simples (o lucro líquido bate centavo por centavo). Não é
            demonstração contábil nem fiscal oficial.
          </p>
        </Panel>

        {q.isLoading ? <Skeleton className="h-72 w-full" /> : null}
        {q.error ? <ErrorState message={`Não foi possível apurar a DRE. ${(q.error as Error).message}`} /> : null}

        {d ? (
          <>
            <Cartoes d={d} spark={spark.data} />

            <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
              <Panel title="Cascata do período">
                <Cascata d={d} foco={foco} onFoco={(c) => setFoco((f) => (f === c ? null : c))} />
                {foco ? (
                  <p className="mt-2 text-xs text-ledger-muted">
                    Tabela filtrada em “{ROTULO_CASCATA[foco] ?? foco}”.{" "}
                    <button type="button" className="underline" onClick={() => setFoco(null)}>
                      Mostrar tudo
                    </button>
                  </p>
                ) : null}
              </Panel>
              <IndicadoresLardan d={d} />
            </div>

            <Panel
              title="Resultado mês a mês"
              flush
              actions={
                <div className="flex gap-1">
                  {[
                    ["valor", "Valores"],
                    ["pct", "% da receita"],
                    ["var", "Variação"],
                  ].map(([k, r]) => (
                    <button
                      key={k}
                      type="button"
                      className={`admin-btn ${modo === k ? "admin-btn-primary" : ""}`}
                      onClick={() => trocar({ modo: k })}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              }
            >
              <Matriz
                d={d}
                modo={modo}
                foco={foco}
                abertos={abertos}
                alternar={(c) =>
                  setAbertos((p) => {
                    const n = new Set(p);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
                onCelula={abrirOrigem}
                onConta={(c, mes) =>
                  setOrigem({
                    titulo: `${c.codigo} · ${c.nome} · ${mes ? nomeMes(mes, false) : "período"}`,
                    mesDe: mes ?? d.meses[0]!,
                    mesAte: mes ?? d.meses[d.meses.length - 1]!,
                    contas: [{ chart_id: c.chart_id, nome: `${c.codigo} · ${c.nome}` }],
                  })
                }
              />
            </Panel>

            <Alertas d={d} onAbrir={(c, mes) => { const l = linha(c); if (l) abrirOrigem(l, mes); }} />

            <Panel
              title={`Pendências (${contarPendencias(pend.data, d)})`}
              actions={
                <button type="button" className="admin-btn" onClick={() => setPendAberto((v) => !v)}>
                  {pendAberto ? "Recolher" : "Ver pendências"}
                </button>
              }
            >
              {pendAberto ? (
                <Pendencias
                  d={d}
                  pend={pend.data}
                  podeMapear={can(caps, "finance.settings.manage")}
                  onMapeado={recarregar}
                />
              ) : (
                <p className="text-sm text-ledger-muted">
                  Sem conta, sem centro, encargos sem conta, contas fora da estrutura e extrato não conciliado — nada
                  some, tudo fica listado aqui.
                </p>
              )}
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Fechamento d={d} caps={caps} onMudou={recarregar} />
              <Orcamento d={d} pode={can(caps, "finance.budget.manage")} onSalvo={recarregar} />
            </div>
          </>
        ) : null}

        <PainelOrigem origem={origem} onClose={() => setOrigem(null)} regime={regime} centro={s.centro} entidade={s.entidade} />
      </div>
    </AreaFinanceiraGuard>
  );
}

/* ---------------- Cartões ---------------- */

function Cartoes({ d, spark }: { d: DreGerencial; spark: DreGerencial | undefined }) {
  const L = (c: string) => d.linhas.find((l) => l.codigo === c)!;
  const S = (c: string) => spark?.linhas.find((l) => l.codigo === c);
  const rl = L("receita_liquida");
  const lb = L("lucro_bruto");
  const eb = L("ebitda");
  const ll = L("lucro_liquido");
  const margem = (l: DreLinhaG, base: number) => (base === 0 ? null : (l.total / base) * 100);
  const serie = (c: string, f: (v: number, m: string) => number = (v) => v) =>
    (spark?.meses ?? []).map((m) => ({ m, v: f(S(c)?.valores[m] ?? 0, m) }));
  const margemSerie = serie("lucro_bruto", (v, m) => {
    const b = S("receita_liquida")?.valores[m] ?? 0;
    return b === 0 ? 0 : (v / b) * 100;
  });
  const cards = [
    { rot: "Receita líquida", valor: formatBRLFromCents(rl.total), a: rl.total, b: rl.total_comparativo, serie: serie("receita_liquida") },
    {
      rot: "Margem bruta",
      valor: pct(margem(lb, rl.total)),
      a: margem(lb, rl.total) ?? 0,
      b: margem({ ...lb, total: lb.total_comparativo }, rl.total_comparativo) ?? 0,
      serie: margemSerie,
      pp: true,
    },
    {
      rot: "EBITDA",
      valor: formatBRLFromCents(eb.total),
      extra: pct(margem(eb, rl.total)),
      a: eb.total,
      b: eb.total_comparativo,
      serie: serie("ebitda"),
    },
    { rot: "Lucro líquido", valor: formatBRLFromCents(ll.total), a: ll.total, b: ll.total_comparativo, serie: serie("lucro_liquido") },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => {
        const delta = c.pp ? c.a - c.b : variacaoPct(c.a, c.b);
        const bom = c.a >= c.b;
        return (
          <div key={c.rot} className="ledger-panel px-5 py-4">
            <p className="ledger-eyebrow">{c.rot}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ledger-text">
              {c.valor}
              {c.extra ? <span className="ml-2 text-sm font-semibold text-ledger-muted">{c.extra}</span> : null}
            </p>
            <p className={`mt-1 text-xs font-semibold tabular-nums ${bom ? "text-success" : "text-danger"}`}>
              {delta === null ? "sem base de comparação" : `${bom ? "▲" : "▼"} ${c.pp ? `${delta.toFixed(1)} p.p.` : pct(Math.abs(delta))}`}
            </p>
            <div className="mt-2 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={c.serie}>
                  <Line type="monotone" dataKey="v" stroke="var(--color-champagne)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-ledger-muted">últimos 12 meses</p>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Cascata ---------------- */

function Cascata({ d, foco, onFoco }: { d: DreGerencial; foco: string | null; onFoco: (c: string) => void }) {
  let acum = 0;
  const dados: { nome: string; codigo: string; base: number; valor: number; real: number; tipo: string }[] = [];
  for (const l of d.linhas) {
    if (l.tipo !== "grupo") continue;
    if (l.codigo !== "receita_bruta" && l.total === 0) continue;
    const ini = acum;
    acum += l.total;
    dados.push({ nome: ROTULO_CASCATA[l.codigo] ?? l.rotulo, codigo: l.codigo, base: Math.min(ini, acum) / 100, valor: Math.abs(l.total) / 100, real: l.total, tipo: "g" });
  }
  dados.push({ nome: "Lucro líquido", codigo: "lucro_liquido", base: Math.min(0, acum) / 100, valor: Math.abs(acum) / 100, real: acum, tipo: "t" });
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
          <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toLocaleString("pt-BR")}k`} />
          <Tooltip
            formatter={(_v, _n, p) => [formatBRLFromCents((p.payload as { real: number }).real), "Valor"]}
            cursor={{ fill: "var(--color-cream-2, transparent)" }}
          />
          <Bar dataKey="base" stackId="a" fill="transparent" />
          <Bar dataKey="valor" stackId="a" onClick={(p) => onFoco((p as unknown as { codigo: string }).codigo)} cursor="pointer">
            {dados.map((x) => (
              <Cell
                key={x.codigo}
                fill={x.tipo === "t" ? "var(--color-ink)" : x.real >= 0 ? "var(--color-success)" : "var(--color-danger)"}
                opacity={foco && foco !== x.codigo ? 0.35 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Matriz ---------------- */

function corVariacao(atual: number, comp: number) {
  // valores já vêm com sinal de resultado: maior é sempre melhor
  const v = variacaoPct(atual, comp);
  if (v === null || Math.abs(v) < 2) return "";
  const forte = Math.abs(v) >= 25;
  return atual > comp ? (forte ? "bg-success/25" : "bg-success/10") : forte ? "bg-danger/25" : "bg-danger/10";
}

function Matriz({
  d,
  modo,
  foco,
  abertos,
  alternar,
  onCelula,
  onConta,
}: {
  d: DreGerencial;
  modo: string;
  foco: string | null;
  abertos: Set<string>;
  alternar: (c: string) => void;
  onCelula: (l: DreLinhaG, mes: string | null) => void;
  onConta: (c: DreLinhaG["contas"][number], mes: string | null) => void;
}) {
  const fechados = new Set(d.meses_fechados);
  const linhas = d.linhas.filter((l) => !foco || l.codigo === foco || l.tipo === "subtotal");
  const celula = (l: DreLinhaG, mes: string | null) => {
    const v = mes ? (l.valores[mes] ?? 0) : l.total;
    const c = mes ? (l.comparativo[mes] ?? 0) : l.total_comparativo;
    if (modo === "pct") return pct(mes ? l.pct_receita?.[mes] : l.pct_receita_total);
    if (modo === "var") {
      const p = variacaoPct(v, c);
      return (
        <span className="flex flex-col items-end leading-tight">
          <span>{p === null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(1)}%`}</span>
          <span className="text-[10px] text-ledger-muted">{formatBRLFromCents(v - c)}</span>
        </span>
      );
    }
    return formatBRLFromCents(v);
  };
  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th className="sticky left-0 z-30 min-w-[300px] border-b border-line-soft bg-card px-5 py-3 text-left font-semibold">
              Linha
            </th>
            {d.meses.map((m) => (
              <th key={m} className="min-w-[120px] border-b border-line-soft px-3 py-3 text-right font-semibold">
                <span className="inline-flex items-center gap-1">
                  {fechados.has(m) ? <Lock className="size-3 text-ledger-muted" aria-label="Mês fechado" /> : null}
                  {nomeMes(m)}
                </span>
              </th>
            ))}
            <th className="min-w-[140px] border-b border-line-soft bg-cream-2 px-3 py-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const sub = l.tipo === "subtotal";
            const aberto = abertos.has(l.codigo);
            const bg = sub ? "bg-cream-2" : "bg-card";
            return (
              <React.Fragment key={l.codigo}>
                <tr className={sub ? "font-bold" : ""}>
                  <td className={`sticky left-0 z-10 border-b border-line-soft/60 px-5 py-2 ${bg}`}>
                    {l.tipo === "grupo" && l.contas.length > 0 ? (
                      <button type="button" className="inline-flex items-center gap-1 text-left" onClick={() => alternar(l.codigo)}>
                        {aberto ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        {l.rotulo}
                        <span className="text-xs font-normal text-ledger-muted">({l.contas.length})</span>
                      </button>
                    ) : (
                      <span className="pl-5">{l.rotulo}</span>
                    )}
                  </td>
                  {[...d.meses, null].map((m) => {
                    const v = m ? (l.valores[m] ?? 0) : l.total;
                    const c = m ? (l.comparativo[m] ?? 0) : l.total_comparativo;
                    return (
                      <td
                        key={m ?? "t"}
                        className={`border-b border-line-soft/60 px-3 py-2 text-right tabular-nums ${m ? "" : "bg-cream-2"} ${
                          sub && m ? "bg-cream-2" : ""
                        } ${modo === "var" ? corVariacao(v, c) : ""}`}
                      >
                        <button
                          type="button"
                          className="w-full text-right hover:underline focus-visible:ring-2 focus-visible:ring-champagne focus-visible:outline-none"
                          onClick={() => onCelula(l, m)}
                        >
                          {celula(l, m)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
                {aberto
                  ? l.contas.map((c) => (
                      <tr key={c.chart_id} className="text-ledger-muted">
                        <td className="sticky left-0 z-10 border-b border-line-soft/40 bg-card py-1.5 pr-5 pl-12 text-xs">
                          {c.codigo} · {c.nome}
                        </td>
                        {[...d.meses, null].map((m) => (
                          <td key={m ?? "t"} className={`border-b border-line-soft/40 px-3 py-1.5 text-right text-xs tabular-nums ${m ? "" : "bg-cream-2"}`}>
                            <button type="button" className="w-full text-right hover:underline" onClick={() => onConta(c, m)}>
                              {formatBRLFromCents(m ? (c.valores[m] ?? 0) : c.total)}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Indicadores, alertas, pendências ---------------- */

function IndicadoresLardan({ d }: { d: DreGerencial }) {
  const i = d.indicadores_lardan;
  const base = i.receita_liquida_cents;
  const p = (v: number) => (base === 0 ? "—" : pct((Math.abs(v) / Math.abs(base)) * 100));
  return (
    <Panel title="Indicadores Lardan">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-ledger-muted">Comissões % da receita</dt>
          <dd className="font-semibold tabular-nums">{p(i.comissoes_cents)} · {formatBRLFromCents(Math.abs(i.comissoes_cents))}</dd>
        </div>
        <div>
          <dt className="text-ledger-muted">Tarifas Asaas % da receita</dt>
          <dd className="font-semibold tabular-nums">{p(i.tarifas_asaas_cents)} · {formatBRLFromCents(Math.abs(i.tarifas_asaas_cents))}</dd>
        </div>
        <div>
          <dt className="text-ledger-muted">Custo de cobrança por R$ 1 recebido</dt>
          <dd className="font-semibold tabular-nums">
            {i.recebido_cents === 0
              ? "—"
              : `R$ ${(Math.abs(i.custo_cobranca_cents) / i.recebido_cents).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`}
          </dd>
        </div>
        <div>
          <dt className="text-ledger-muted">Inadimplência % por representante</dt>
          <dd className="text-xs text-ledger-muted">{i.inadimplencia_nota}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function Alertas({ d, onAbrir }: { d: DreGerencial; onAbrir: (codigo: string, mes: string) => void }) {
  return (
    <Panel title={`Alertas (${d.alertas.length})`}>
      {d.alertas.length === 0 ? (
        <p className="text-sm text-ledger-muted">
          Nenhuma linha variou mais de 25% contra a média dos 3 meses anteriores com valor acima de R$ 1.000.
        </p>
      ) : (
        <ul className="space-y-2">
          {d.alertas.map((a) => (
            <li key={`${a.codigo}-${a.mes}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 rounded-[10px] border border-line-soft px-4 py-3 text-left hover:bg-cream-2"
                onClick={() => onAbrir(a.codigo, a.mes)}
              >
                <span>
                  <strong>{a.rotulo.replace(/^[=(−+/) ]+/, "")}</strong> em {nomeMes(a.mes, false)}: {formatBRLFromCents(a.valor_cents)} contra
                  média de {formatBRLFromCents(a.media3_cents)}
                </span>
                <span className={`font-semibold tabular-nums ${a.pior ? "text-danger" : "text-success"}`}>
                  {a.variacao_pct > 0 ? "+" : ""}
                  {a.variacao_pct.toLocaleString("pt-BR")}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type PendFinDre = Awaited<ReturnType<typeof fetchFinDre>> | undefined;

function contarPendencias(p: PendFinDre, d: DreGerencial) {
  const ind = p?.indicadores;
  const fora = d.linhas.find((l) => l.codigo === "fora_estrutura")?.contas.length ?? 0;
  if (!ind) return fora;
  return (
    (ind.sem_conta_contabil?.quantidade ?? 0) +
    (ind.sem_centro_custo?.quantidade ?? 0) +
    (ind.encargos_sem_conta?.quantidade ?? 0) +
    (ind.nao_conciliados?.quantidade ?? 0) +
    fora
  );
}

function Pendencias({
  d,
  pend,
  podeMapear,
  onMapeado,
}: {
  d: DreGerencial;
  pend: PendFinDre;
  podeMapear: boolean;
  onMapeado: () => void;
}) {
  const ind = pend?.indicadores;
  const fora = d.linhas.find((l) => l.codigo === "fora_estrutura")?.contas ?? [];
  const opcoes = d.linhas
    .filter((l) => l.tipo === "grupo" && l.codigo !== "fora_estrutura")
    .map((l) => ({ value: l.codigo, label: l.rotulo.replace(/^[=(−+/) ]+/, "") }));
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["sem_conta_contabil", "Sem conta do plano de contas"],
            ["sem_centro_custo", "Sem centro de custo"],
            ["encargos_sem_conta", "Encargos sem conta"],
            ["nao_conciliados", "Extrato não conciliado"],
          ] as const
        ).map(([k, r]) => (
          <li key={k} className="rounded-[10px] border border-line-soft p-3">
            <p className="text-sm font-semibold">{r}</p>
            <p className="tabular-nums">
              {ind?.[k]?.quantidade ?? 0} · {formatBRLFromCents(ind?.[k]?.valor_cents ?? 0)}
            </p>
            <p className="mt-1 text-xs text-ledger-muted">{ind?.[k]?.criterio}</p>
          </li>
        ))}
      </ul>
      <div>
        <p className="text-sm font-semibold">Contas fora da estrutura ({fora.length})</p>
        <p className="text-xs text-ledger-muted">
          Entram no lucro líquido (para bater com a DRE simples), mas ainda não têm linha própria. O mapa inicial é uma
          proposta para o Daniel revisar.
        </p>
        <ul className="mt-2 divide-y divide-line-soft/60">
          {fora.map((c) => (
            <li key={c.chart_id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span>
                {c.codigo} · {c.nome} · <span className="tabular-nums">{formatBRLFromCents(c.total)}</span>
              </span>
              {podeMapear ? (
                <SmartSelect
                  options={[{ value: "", label: "Escolher linha da DRE" }, ...opcoes]}
                  value=""
                  onChange={async (v) => {
                    if (!v) return;
                    try {
                      await mapearConta(c.chart_id, v);
                      toast.success("Conta ligada à linha da DRE.");
                      onMapeado();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                  className="w-64"
                />
              ) : null}
            </li>
          ))}
          {fora.length === 0 ? <li className="py-2 text-sm text-ledger-muted">Nenhuma.</li> : null}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- Fechamento ---------------- */

function Fechamento({ d, caps, onMudou }: { d: DreGerencial; caps: ReturnType<typeof useCapabilities>; onMudou: () => void }) {
  const qc = useQueryClient();
  const per = useQuery({ queryKey: ["fin-periodos"], queryFn: fetchPeriodos });
  const [acao, setAcao] = React.useState<{ mes: string; tipo: "fechar" | "reabrir" } | null>(null);
  const [motivo, setMotivo] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const fechados = new Set((per.data ?? []).filter((p) => p.situacao === "fechado" && !p.business_entity_id).map((p) => p.mes.slice(0, 7)));
  const confirmar = async () => {
    if (!acao) return;
    setSalvando(true);
    try {
      if (acao.tipo === "fechar") await fecharPeriodo(`${acao.mes}-01`, motivo);
      else await reabrirPeriodo(`${acao.mes}-01`, motivo);
      toast.success(acao.tipo === "fechar" ? "Mês fechado." : "Mês reaberto.");
      setAcao(null);
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["fin-periodos"] });
      onMudou();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Panel title="Fechamento mensal">
      <p className="mb-3 text-xs text-ledger-muted">
        Mês fechado bloqueia novos lançamentos, alterações, baixas e reclassificações com data dentro dele. Reabrir exige
        permissão própria e motivo; tudo fica na auditoria.
      </p>
      <ul className="divide-y divide-line-soft/60">
        {d.meses.map((m) => {
          const f = fechados.has(m);
          return (
            <li key={m} className="flex items-center justify-between py-2 text-sm">
              <span className="inline-flex items-center gap-2">
                {f ? <Lock className="size-4" /> : <Unlock className="size-4 text-ledger-muted" />}
                {nomeMes(m, false)} · {f ? "fechado" : "aberto"}
              </span>
              {f ? (
                can(caps, "finance.period.reopen") ? (
                  <button type="button" className="admin-btn" onClick={() => setAcao({ mes: m, tipo: "reabrir" })}>
                    Reabrir
                  </button>
                ) : null
              ) : can(caps, "finance.period.close") ? (
                <button type="button" className="admin-btn" onClick={() => setAcao({ mes: m, tipo: "fechar" })}>
                  Fechar mês
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Dialog open={acao !== null} onOpenChange={(v) => !v && setAcao(null)}>
        <DialogContent className="admin-scope">
          <DialogHeader>
            <DialogTitle>
              {acao?.tipo === "fechar" ? "Fechar" : "Reabrir"} {acao ? nomeMes(acao.mes, false) : ""}
            </DialogTitle>
            <DialogDescription>
              {acao?.tipo === "fechar"
                ? "Depois de fechado, nada com data neste mês pode ser lançado, alterado ou baixado."
                : "Informe por que o mês precisa ser reaberto. O motivo fica registrado na auditoria."}
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="admin-input min-h-24 w-full"
            placeholder={acao?.tipo === "fechar" ? "Observação (opcional)" : "Motivo da reabertura (obrigatório)"}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="admin-btn" onClick={() => setAcao(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={salvando || (acao?.tipo === "reabrir" && motivo.trim().length < 5)}
              onClick={() => void confirmar()}
            >
              Confirmar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* ---------------- Orçamento ---------------- */

function Orcamento({ d, pode, onSalvo }: { d: DreGerencial; pode: boolean; onSalvo: () => void }) {
  const grupos = d.linhas.filter((l) => l.tipo === "grupo" && l.codigo !== "fora_estrutura");
  const [mes, setMes] = React.useState(d.meses[d.meses.length - 1]!);
  const [linhaSel, setLinhaSel] = React.useState(grupos[0]?.codigo ?? "");
  const [valor, setValor] = React.useState("");
  const [previa, setPrevia] = React.useState<{ mes: string; linha: string; valor_cents: number }[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const centavos = (txt: string) => {
    const limpo = txt.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(limpo);
    return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : NaN;
  };

  const salvarUm = async () => {
    const v = centavos(valor);
    if (!Number.isFinite(v)) return toast.error("Valor inválido.");
    try {
      await salvarOrcamento([{ mes: `${mes}-01`, linha: linhaSel, valor_cents: v }], "tela");
      toast.success("Orçamento salvo.");
      setValor("");
      onSalvo();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const lerPlanilha = async (f: File) => {
    setErro(null);
    if (f.size > 2_000_000) return setErro("Arquivo acima de 2 MB.");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { raw: false });
    const codigos = new Set(grupos.map((g) => g.codigo));
    const out: { mes: string; linha: string; valor_cents: number }[] = [];
    for (const [i, r] of rows.entries()) {
      const m = String(r["mes"] ?? r["Mês"] ?? r["mês"] ?? "").trim();
      const l = String(r["linha"] ?? r["Linha"] ?? "").trim();
      const v = centavos(String(r["valor"] ?? r["Valor"] ?? ""));
      const mm = /^(\d{4})-(\d{2})/.exec(m) ?? (/^(\d{2})\/(\d{4})$/.exec(m) ? [m, m.slice(3), m.slice(0, 2)] : null);
      if (!mm || !codigos.has(l) || !Number.isFinite(v)) return setErro(`Linha ${i + 2} inválida: use colunas mes (AAAA-MM), linha (código) e valor.`);
      out.push({ mes: `${mm[1]}-${mm[2]}-01`, linha: l, valor_cents: v });
    }
    if (out.length === 0) return setErro("Planilha vazia.");
    setPrevia(out);
  };

  return (
    <Panel title="Orçamento">
      <p className="mb-3 text-xs text-ledger-muted">
        Valores sempre positivos; o sistema aplica o sinal da linha (receita soma, despesa subtrai). Use o comparativo
        “orçado” no topo para ver a diferença.
      </p>
      {pode ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SmartSelect options={d.meses.map((m) => ({ value: m, label: nomeMes(m, false) }))} value={mes} onChange={setMes} className="w-44" />
            <SmartSelect
              options={grupos.map((g) => ({ value: g.codigo, label: g.rotulo.replace(/^[=(−+/) ]+/, "") }))}
              value={linhaSel}
              onChange={setLinhaSel}
              className="w-64"
            />
            <input className="admin-input w-36" inputMode="decimal" placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => void salvarUm()} disabled={!valor}>
              Salvar
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="admin-btn cursor-pointer">
              <Upload className="size-4" /> Importar planilha
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void lerPlanilha(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className="admin-btn"
              onClick={() => {
                const ws = XLSX.utils.aoa_to_sheet([["mes", "linha", "valor"], ...grupos.map((g) => [d.meses[0], g.codigo, 0])]);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "orcamento");
                XLSX.writeFile(wb, "modelo-orcamento-lardan.xlsx");
              }}
            >
              Baixar modelo
            </button>
          </div>
          {erro ? <p className="text-sm text-danger">{erro}</p> : null}
          {previa ? (
            <div className="rounded-[10px] border border-line-soft p-3 text-sm">
              <p className="font-semibold">{previa.length} linha(s) prontas para gravar</p>
              <p className="text-xs text-ledger-muted">
                Total {formatBRLFromCents(previa.reduce((a, b) => a + b.valor_cents, 0))}. Linhas iguais (mês + linha) substituem o valor anterior.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="admin-btn" onClick={() => setPrevia(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  onClick={async () => {
                    try {
                      const r = await salvarOrcamento(previa, "planilha");
                      toast.success(`${r.gravadas} linha(s) de orçamento gravadas.`);
                      setPrevia(null);
                      onSalvo();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  Gravar orçamento
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ledger-muted">Você pode consultar, mas não editar o orçamento.</p>
      )}
    </Panel>
  );
}

/* ---------------- Origem ---------------- */

function PainelOrigem({
  origem,
  onClose,
  regime,
  centro,
  entidade,
}: {
  origem: Origem;
  onClose: () => void;
  regime: "competencia" | "caixa";
  centro: string | undefined;
  entidade: string | undefined;
}) {
  const det = useQuery({
    queryKey: ["fin-dre-g-origem", origem, regime, centro, entidade],
    enabled: origem !== null && origem.contas.length > 0,
    queryFn: async () => {
      const o = origem!;
      const res = await Promise.all(
        o.contas.map((c) =>
          fetchFinDreDetalhe({
            de: `${o.mesDe}-01`,
            ate: fimDoMes(o.mesAte),
            regime,
            chart_id: c.chart_id,
            ...(centro ? { centro_custo_id: centro } : {}),
            ...(entidade ? { entidade_id: entidade } : {}),
          }).then((r) => ({ conta: c.nome, ...r })),
        ),
      );
      return res.filter((r) => r.rows.length > 0);
    },
  });
  return (
    <Sheet open={origem !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="admin-scope w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{origem?.titulo}</SheetTitle>
          <SheetDescription>Títulos e movimentos que formam o valor, com os mesmos filtros e regime.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-5 px-4 pb-6">
          {origem && origem.contas.length === 0 ? <p className="text-sm text-ledger-muted">Nenhum valor nesta célula.</p> : null}
          {det.isLoading ? <Skeleton className="h-40 w-full" /> : null}
          {det.error ? <ErrorState message="Não foi possível abrir a origem." /> : null}
          {det.data?.length === 0 ? <p className="text-sm text-ledger-muted">Nenhum registro.</p> : null}
          {det.data?.map((g) => (
            <section key={g.conta}>
              <p className="flex justify-between text-sm font-semibold">
                <span>{g.conta}</span>
                <span className="tabular-nums">{formatBRLFromCents(g.soma_cents)}</span>
              </p>
              <ul className="mt-1 divide-y divide-line-soft/60 text-sm">
                {g.rows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-4 py-1.5">
                    <span>
                      {new Date(`${r.data}T12:00:00`).toLocaleDateString("pt-BR")} · {r.descricao ?? "—"}
                      <span className="text-ledger-muted"> · {r.contraparte}</span>
                    </span>
                    <span className="tabular-nums">{formatBRLFromCents(r.valor_cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------- Exportação ---------------- */

function exportarExcel(d: DreGerencial) {
  const cab = ["Linha", ...d.meses.map((m) => nomeMes(m)), "Total"];
  const aoa: (string | number | { f: string })[][] = [cab];
  const linhaExcel: Record<string, number> = {};
  const col = (i: number) => XLSX.utils.encode_col(i);
  const grupos: number[] = [];
  d.linhas.forEach((l) => {
    const r = aoa.length + 1; // linha 1-based
    linhaExcel[l.codigo] = r;
    const valores = d.meses.map((m, i) =>
      l.tipo === "grupo"
        ? (l.valores[m] ?? 0) / 100
        : { f: grupos.length ? grupos.map((g) => `${col(i + 1)}${g}`).join("+") : "0" },
    );
    aoa.push([l.rotulo, ...valores, { f: `SUM(B${r}:${col(d.meses.length)}${r})` }]);
    if (l.tipo === "grupo") grupos.push(r);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 42 }, ...d.meses.map(() => ({ wch: 14 })), { wch: 16 }];
  const origem: (string | number)[][] = [["Linha", "Código", "Conta", ...d.meses.map((m) => nomeMes(m)), "Total"]];
  d.linhas.forEach((l) =>
    l.contas.forEach((c) => origem.push([l.rotulo, c.codigo, c.nome, ...d.meses.map((m) => (c.valores[m] ?? 0) / 100), c.total / 100])),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DRE");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(origem), "Origem");
  XLSX.writeFile(wb, `dre-gerencial-lardan-${d.meses[0]}-${d.meses[d.meses.length - 1]}.xlsx`);
}

function exportarPdf(d: DreGerencial, regime: string) {
  const L = (c: string) => d.linhas.find((l) => l.codigo === c)!;
  const rl = L("receita_liquida").total;
  const card = (r: string, v: string) => `<div class="c"><small>${r}</small><b>${v}</b></div>`;
  const m = (l: DreLinhaG) => (rl === 0 ? "—" : pct((l.total / rl) * 100));
  const grupos = d.linhas.filter((l) => l.tipo === "grupo" && l.total !== 0);
  const max = Math.max(1, ...grupos.map((g) => Math.abs(g.total)));
  const logo = `${window.location.origin}/email/lardan-logo.png`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DRE gerencial LARDAN</title>
<style>body{font-family:'IBM Plex Sans',Arial,sans-serif;color:#1d1a17;margin:32px}h1{font-size:20px;margin:0}
.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd;padding-bottom:12px}
.cs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.c{border:1px solid #ddd;border-radius:10px;padding:10px}
.c small{display:block;color:#777}.c b{font-size:16px}table{width:100%;border-collapse:collapse;font-size:12px}
td{padding:5px 8px;border-bottom:1px solid #eee}td.v{text-align:right;font-variant-numeric:tabular-nums}tr.s td{font-weight:700;background:#f6f2ec}
.bar{display:flex;align-items:center;gap:8px;font-size:11px;margin:3px 0}.bar i{display:block;height:10px;border-radius:3px}
footer{margin-top:18px;font-size:10px;color:#777}</style></head><body>
<div class="top"><div><h1>DRE gerencial</h1><div>${nomeMes(d.meses[0]!, false)} a ${nomeMes(d.meses[d.meses.length - 1]!, false)} · regime de ${regime === "caixa" ? "caixa" : "competência"}</div></div><img src="${logo}" alt="LARDAN" height="40"></div>
<div class="cs">${card("Receita líquida", formatBRLFromCents(rl))}${card("Margem bruta", m(L("lucro_bruto")))}${card("EBITDA", `${formatBRLFromCents(L("ebitda").total)} (${m(L("ebitda"))})`)}${card("Lucro líquido", formatBRLFromCents(L("lucro_liquido").total))}</div>
<h3>Cascata</h3>${grupos.map((g) => `<div class="bar"><span style="width:180px">${g.rotulo}</span><i style="width:${(Math.abs(g.total) / max) * 300}px;background:${g.total >= 0 ? "#2f7d4f" : "#b3412f"}"></i>${formatBRLFromCents(g.total)}</div>`).join("")}
<h3>Resumo</h3><table>${d.linhas.map((l) => `<tr class="${l.tipo === "subtotal" ? "s" : ""}"><td>${l.rotulo}</td><td class="v">${formatBRLFromCents(l.total)}</td><td class="v">${pct(l.pct_receita_total)}</td></tr>`).join("")}</table>
<footer>Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Apuração gerencial interna; não é demonstração contábil nem fiscal oficial.</footer>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return toast.error("Libere a abertura de janelas para gerar o PDF.");
  w.document.write(html);
  w.document.close();
}

import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { carteira, moverEtapa, brl, dataBR, hojeSP, ETAPAS, rotuloEtapa, type Devedor, type Etapa } from "@/lib/cobranca";

const busca = z.object({
  v: z.enum(["lista", "kanban", "agenda", "bi"]).catch("lista"),
  q: z.string().catch(""),
  f: z.string().catch(""),
  etapa: z.string().catch(""),
  faixa: z.string().catch(""),
});

export const Route = createFileRoute("/_authenticated/admin/cobranca")({
  validateSearch: busca,
  head: () => ({ meta: [{ title: "Cobrança — Painel Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Cobranca,
});

const FAIXAS: Record<string, [number, number, string]> = {
  "1-15": [1, 15, "1 a 15 dias"], "16-30": [16, 30, "16 a 30 dias"], "31-90": [31, 90, "31 a 90 dias"], "91+": [91, 99999, "Mais de 90 dias"],
};

function Cobranca() {
  const s = Route.useSearch();
  const nav = useNavigate({ from: "/admin/cobranca" });
  const set = (p: Partial<z.infer<typeof busca>>) => nav({ search: (o) => ({ ...o, ...p }), replace: true });
  const q = useQuery({ queryKey: ["cob", "carteira"], queryFn: carteira });
  const qc = useQueryClient();
  const hoje = hojeSP();
  const todos = q.data ?? [];

  const kpi = {
    vencido: todos.reduce((a, d) => a + Number(d.vencido_cents), 0),
    devedores: todos.length,
    hoje: todos.filter((d) => d.proxima_acao === hoje).length,
    atrasadas: todos.filter((d) => d.proxima_acao && d.proxima_acao < hoje).length,
    vencendo: todos.filter((d) => d.promessa_status === "vigente" && d.promessa_data && d.promessa_data <= addDias(hoje, 2)).length,
    descumpridas: todos.filter((d) => d.promessa_status === "descumprida").length,
  };
  const filtroKpi: Record<string, (d: Devedor) => boolean> = {
    hoje: (d) => d.proxima_acao === hoje,
    atrasadas: (d) => !!d.proxima_acao && d.proxima_acao < hoje,
    vencendo: (d) => d.promessa_status === "vigente" && !!d.promessa_data && d.promessa_data <= addDias(hoje, 2),
    descumpridas: (d) => d.promessa_status === "descumprida",
  };
  const termo = s.q.trim().toLowerCase();
  const lista = todos.filter((d) =>
    (!termo || [d.nome, d.documento, d.cidade, d.uf, d.responsavel_nome].some((x) => x?.toLowerCase().includes(termo))) &&
    (!s.f || !filtroKpi[s.f] || filtroKpi[s.f](d)) &&
    (!s.etapa || d.etapa === s.etapa) &&
    (!s.faixa || (d.maior_atraso >= FAIXAS[s.faixa][0] && d.maior_atraso <= FAIXAS[s.faixa][1])),
  ).sort((a, b) => Number(b.vencido_cents) - Number(a.vencido_cents));

  const mover = async (d: Devedor, e: Etapa) => {
    try { await moverEtapa(d.party_id, e); qc.invalidateQueries({ queryKey: ["cob"] }); toast.success(`${d.nome}: ${rotuloEtapa(e)}. O financeiro não muda.`); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Não moveu."); }
  };

  const Kpi = ({ id, rotulo, valor, destaque }: { id: string; rotulo: string; valor: string; destaque?: boolean }) => (
    <button onClick={() => set({ f: s.f === id ? "" : id })}
      className={`rounded-xl border p-4 text-left transition ${s.f === id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"} ${destaque ? "ring-1 ring-destructive/40" : ""}`}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 font-mono text-xl tabular-nums ${destaque ? "text-destructive" : ""}`}>{valor}</p>
    </button>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ledger-eyebrow">Recuperação de crédito</p>
          <h1 className="font-display text-3xl">Central de Cobrança</h1>
          <p className="text-sm text-muted-foreground">Valores vêm do financeiro oficial. Aqui só se registra o atendimento.</p>
        </div>
        <div className="flex rounded-lg border border-border p-1">
          {(["lista", "kanban", "agenda", "bi"] as const).map((v) => (
            <button key={v} onClick={() => set({ v })} className={`rounded-md px-4 py-1.5 text-sm ${s.v === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
              {{ lista: "Lista", kanban: "Kanban", agenda: "Agenda", bi: "BI" }[v]}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi id="" rotulo="Saldo vencido" valor={brl(kpi.vencido)} />
        <Kpi id="" rotulo="Devedoras" valor={String(kpi.devedores)} />
        <Kpi id="hoje" rotulo="Ações de hoje" valor={String(kpi.hoje)} />
        <Kpi id="atrasadas" rotulo="Ações atrasadas" valor={String(kpi.atrasadas)} />
        <Kpi id="vencendo" rotulo="Promessas vencendo" valor={String(kpi.vencendo)} />
        <Kpi id="descumpridas" rotulo="Promessas descumpridas" valor={String(kpi.descumpridas)} destaque={kpi.descumpridas > 0} />
      </div>

      {s.v !== "bi" && (
        <div className="flex flex-wrap gap-2">
          <input value={s.q} onChange={(e) => set({ q: e.target.value })} placeholder="Buscar nome, documento, cidade, responsável…"
            className="h-10 min-w-72 flex-1 rounded-lg border border-border bg-background px-3 text-sm" />
          <Chips valor={s.etapa} opcoes={ETAPAS.map((e) => [e.id, e.rotulo])} onChange={(etapa) => set({ etapa })} />
          <Chips valor={s.faixa} opcoes={Object.entries(FAIXAS).map(([k, v]) => [k, v[2]])} onChange={(faixa) => set({ faixa })} />
        </div>
      )}

      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando a carteira…</p>
        : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        : lista.length === 0 && s.v !== "bi" ? <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Sem dados para estes filtros.</p>
        : s.v === "lista" ? <Lista lista={lista} hoje={hoje} />
        : s.v === "kanban" ? <Kanban lista={lista} onMover={mover} />
        : s.v === "agenda" ? <Agenda lista={lista} hoje={hoje} />
        : <BI todos={todos} />}
    </div>
  );
}

function addDias(d: string, n: number) { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }

function Chips({ valor, opcoes, onChange }: { valor: string; opcoes: string[][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {opcoes.map(([k, r]) => (
        <button key={k} onClick={() => onChange(valor === k ? "" : k)}
          className={`h-10 rounded-full border px-3 text-xs ${valor === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{r}</button>
      ))}
    </div>
  );
}

function Lista({ lista, hoje }: { lista: Devedor[]; hoje: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>{["Devedora", "Etapa", "Vencido", "A vencer", "Parcelas", "Maior atraso", "Responsável", "Próxima ação"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.party_id} className="border-t border-border hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link to="/admin/cobranca/$id" params={{ id: d.party_id }} className="font-medium hover:underline">{d.nome}</Link>
                <p className="text-xs text-muted-foreground">{[d.cidade, d.uf].filter(Boolean).join("/") || "Não informado"}</p>
              </td>
              <td className="px-4 py-3">{rotuloEtapa(d.etapa)}{d.promessa_status === "descumprida" && <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">Promessa descumprida</span>}</td>
              <td className="px-4 py-3 font-mono tabular-nums">{brl(Number(d.vencido_cents))}</td>
              <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">{brl(Number(d.a_vencer_cents))}</td>
              <td className="px-4 py-3">{d.parcelas_vencidas}</td>
              <td className="px-4 py-3">{d.maior_atraso} dias</td>
              <td className="px-4 py-3">{d.responsavel_nome ?? "Não informado"}</td>
              <td className={`px-4 py-3 ${d.proxima_acao && d.proxima_acao < hoje ? "text-destructive" : ""}`}>{d.proxima_acao ? `${dataBR(d.proxima_acao)} · ${d.proxima_acao_titulo}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kanban({ lista, onMover }: { lista: Devedor[]; onMover: (d: Devedor, e: Etapa) => void }) {
  const [arr, setArr] = React.useState<Devedor | null>(null);
  return (
    <div className="grid grid-cols-5 gap-3">
      {ETAPAS.map((e) => {
        const col = lista.filter((d) => d.etapa === e.id);
        return (
          <div key={e.id} onDragOver={(ev) => ev.preventDefault()} onDrop={() => { if (arr && arr.etapa !== e.id) onMover(arr, e.id); setArr(null); }}
            className="min-h-96 rounded-xl border border-border bg-muted/30 p-2">
            <div className="flex items-center justify-between px-2 py-2 text-xs font-medium">
              <span>{e.rotulo}</span><span className="text-muted-foreground">{col.length} · {brl(col.reduce((a, d) => a + Number(d.vencido_cents), 0))}</span>
            </div>
            <div className="space-y-2">
              {col.slice(0, 80).map((d) => (
                <div key={d.party_id} draggable onDragStart={() => setArr(d)}
                  className={`cursor-grab rounded-lg border bg-card p-3 text-xs shadow-sm ${d.promessa_status === "descumprida" ? "border-destructive/60" : "border-border"}`}>
                  <Link to="/admin/cobranca/$id" params={{ id: d.party_id }} className="block text-sm font-medium hover:underline">{d.nome}</Link>
                  <p className="mt-1 font-mono text-sm tabular-nums">{brl(Number(d.vencido_cents))}</p>
                  <p className="text-muted-foreground">{d.parcelas_vencidas} parcela(s) · {d.maior_atraso} dias</p>
                  {d.promessa_status === "descumprida" && <p className="mt-1 text-destructive">Promessa descumprida</p>}
                  {d.proxima_acao && <p className="mt-1 text-muted-foreground">Próxima: {dataBR(d.proxima_acao)}</p>}
                </div>
              ))}
              {col.length > 80 && <p className="px-2 text-xs text-muted-foreground">+{col.length - 80} — use a busca.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ lista, hoje }: { lista: Devedor[]; hoje: string }) {
  const comAcao = lista.filter((d) => d.proxima_acao).sort((a, b) => a.proxima_acao!.localeCompare(b.proxima_acao!));
  const grupos = new Map<string, Devedor[]>();
  comAcao.forEach((d) => { const k = d.proxima_acao! < hoje ? "Atrasadas" : d.proxima_acao === hoje ? "Hoje" : dataBR(d.proxima_acao); grupos.set(k, [...(grupos.get(k) ?? []), d]); });
  if (!comAcao.length) return <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma ação agendada. A régua cria as tarefas todo dia.</p>;
  return (
    <div className="space-y-4">
      {[...grupos].map(([k, ds]) => (
        <section key={k} className="rounded-xl border border-border bg-card p-4">
          <h3 className={`mb-2 text-sm font-medium ${k === "Atrasadas" ? "text-destructive" : ""}`}>{k} · {ds.length}</h3>
          {ds.map((d) => (
            <Link key={d.party_id} to="/admin/cobranca/$id" params={{ id: d.party_id }} className="flex justify-between border-t border-border py-2 text-sm hover:bg-muted/30">
              <span>{d.proxima_acao_titulo} — <b>{d.nome}</b></span><span className="font-mono tabular-nums">{brl(Number(d.vencido_cents))}</span>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

function BI({ todos }: { todos: Devedor[] }) {
  const porChave = (f: (d: Devedor) => string) => {
    const m = new Map<string, { n: number; v: number }>();
    todos.forEach((d) => { const k = f(d) || "Não informado"; const x = m.get(k) ?? { n: 0, v: 0 }; x.n++; x.v += Number(d.vencido_cents); m.set(k, x); });
    return [...m].sort((a, b) => b[1].v - a[1].v).slice(0, 12);
  };
  const total = todos.reduce((a, d) => a + Number(d.vencido_cents), 0);
  const Bloco = ({ t, dados }: { t: string; dados: [string, { n: number; v: number }][] }) => (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-medium">{t}</h3>
      {dados.map(([k, x]) => (
        <div key={k} className="mb-2 text-sm">
          <div className="flex justify-between"><span>{k} <span className="text-muted-foreground">· {x.n}</span></span><span className="font-mono tabular-nums">{brl(x.v)}</span></div>
          <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${total ? (x.v / total) * 100 : 0}%` }} /></div>
        </div>
      ))}
    </section>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <b>Critérios.</b> Total vencido = saldo restante das parcelas vencidas hoje. Inadimplentes = pessoas distintas. Promessas, descontos e cobranças emitidas não contam como recuperação.
        Recuperado, prazo médio e taxa de recuperação por coorte aparecem na ficha de cada devedora a partir das baixas reais.
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Bloco t="Por etapa" dados={porChave((d) => rotuloEtapa(d.etapa))} />
        <Bloco t="Por responsável" dados={porChave((d) => d.responsavel_nome ?? "")} />
        <Bloco t="Por UF" dados={porChave((d) => d.uf ?? "")} />
      </div>
    </div>
  );
}

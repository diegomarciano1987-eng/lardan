import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { startOfMonth, endOfMonth } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR, type Devedor, type Etapa } from "@/lib/cobranca";
import { colunaDoDevedor, type AcordoSit, type Coluna } from "@/lib/cobranca-kanban";
import { soHistorica, type DevedorHistorico } from "@/lib/cobranca-historica";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

export const acordosQuery = { queryKey: ["cob", "acordos-sit"], queryFn: async () => { const { data, error } = await rpc("cob_acordos_situacao"); if (error) throw new Error(error.message); return (data ?? []) as AcordoSit[]; } };

const COLS: { id: Coluna; rotulo: string; ajuda: string; faixa: string; tom: string; destino?: Etapa }[] = [
  { id: "regua", rotulo: "Régua Asaas", ajuda: "Automática — o Asaas está avisando. Só leitura.", faixa: "bg-asaas", tom: "text-asaas" },
  { id: "negociacao", rotulo: "Em negociação", ajuda: "Contato humano em andamento.", faixa: "bg-info", tom: "text-info", destino: "em_contato" },
  { id: "acordo", rotulo: "Acordo em andamento", ajuda: "Acordo fechado e em dia.", faixa: "bg-success", tom: "text-success", destino: "em_negociacao" },
  { id: "atrasado", rotulo: "Acordo atrasado", ajuda: "Parcela do acordo vencida. Uma única prorrogação.", faixa: "bg-danger", tom: "text-danger" },
  { id: "judicial", rotulo: "Judicial", ajuda: "Com o jurídico.", faixa: "bg-bronze", tom: "text-bronze", destino: "acompanhamento" },
];

export function KanbanCobranca({ lista, onMover }: { lista: Devedor[]; onMover: (d: Devedor, e: Etapa) => void }) {
  const qc = useQueryClient();
  const qa = useQuery(acordosQuery);
  const sit = React.useMemo(() => new Map((qa.data ?? []).map((a) => [a.party_id, a])), [qa.data]);
  // Quem só tem dívida até 2025 sai da Régua Asaas: é tratado na aba Cobrança histórica.
  const qh = useQuery({ queryKey: ["cob", "historica"], queryFn: async () => { const { data, error } = await rpc("cob_historica_lista"); if (error) throw new Error(error.message); return (data ?? []) as DevedorHistorico[]; } });
  const historicas = React.useMemo(() => new Set((qh.data ?? []).filter(soHistorica).map((d) => d.party_id)), [qh.data]);
  const [arr, setArr] = React.useState<Devedor | null>(null);
  const [sobre, setSobre] = React.useState<Coluna | null>(null);
  const [prorrogar, setProrrogar] = React.useState<Devedor | null>(null);
  const [motivo, setMotivo] = React.useState("");

  const confirmarProrrogacao = async () => {
    if (!prorrogar) return;
    const { error } = await rpc("cob_acordo_prorrogar", { _party: prorrogar.party_id, _motivo: motivo });
    if (error) { toast.error(error.message); return; }
    toast.success("Prorrogação registrada. Ajuste a data da cobrança no Asaas pelo acordo.");
    setProrrogar(null); setMotivo(""); qc.invalidateQueries({ queryKey: ["cob"] });
  };

  return (
    <>
      <div className="grid grid-cols-5 gap-3">
        {COLS.map((c) => {
          const todas = lista.filter((d) => colunaDoDevedor(d, sit.get(d.party_id)) === c.id);
          const col = c.id === "regua" ? todas.filter((d) => !historicas.has(d.party_id)) : todas;
          const foraHist = todas.length - col.length;
          return (
            <section key={c.id} data-coluna={c.id}
              onDragOver={(ev) => { if (c.destino) { ev.preventDefault(); setSobre(c.id); } }} onDragLeave={() => setSobre(null)}
              onDrop={() => { if (arr && c.destino && arr.etapa !== c.destino) onMover(arr, c.destino); setArr(null); setSobre(null); }}
              className={`flex min-h-96 flex-col overflow-hidden rounded-2xl border bg-card transition ${sobre === c.id ? "border-bronze ring-2 ring-bronze/30" : "border-border"}`}>
              <div className={`h-1.5 ${c.faixa}`} />
              <header className="px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={`text-sm font-semibold ${c.tom}`}>{c.rotulo}</h3>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">{col.length}</span>
                </div>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{brl(col.reduce((a, d) => a + Number(d.vencido_cents), 0))} vencido</p>
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">{c.ajuda}</p>
                {c.id === "regua" && foraHist > 0 && (
                  <Link to="/admin/cobranca" search={(o) => ({ ...o, v: "historica" as const })} className="mt-1 block text-[0.6875rem] text-asaas underline" data-fora-historica={foraHist}>
                    {foraHist} só com dívida até 2025 estão em Histórica
                  </Link>
                )}
                {c.id === "regua" && (
                  <div className="mt-2 flex gap-1 text-[0.625rem]">
                    {([["1–3 dias", 1, 3], ["4–7 dias", 4, 7], ["8+ dias", 8, 1e9]] as const).map(([r, a, b]) => (
                      <span key={r} className="rounded border border-asaas/40 px-1.5 py-0.5 text-asaas">{r}: {col.filter((d) => d.maior_atraso >= a && d.maior_atraso <= b).length}</span>
                    ))}
                  </div>
                )}
              </header>
              <div className="flex-1 space-y-2 p-2">
                {col.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Sem dados.</p>}
                {col.slice(0, 80).map((d) => {
                  const a = sit.get(d.party_id);
                  return (
                    <article key={d.party_id} draggable onDragStart={() => setArr(d)} className="relative cursor-grab overflow-hidden rounded-xl border border-border bg-background p-3 pl-4 text-xs shadow-sm hover:shadow-md">
                      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${c.faixa}`} />
                      <Link to="/admin/cobranca/$id" params={{ id: d.party_id }} className="block truncate text-sm font-semibold hover:text-bronze">{d.nome}</Link>
                      <p className="truncate text-muted-foreground">{d.codigo_legado ? `Cód. ${d.codigo_legado} · ` : ""}{d.praca_nome ?? [d.cidade, d.uf].filter(Boolean).join("/")}</p>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="font-mono text-base font-semibold tabular-nums">{brl(Number(d.vencido_cents))}</span>
                        <span className={`font-semibold ${d.maior_atraso > 90 ? "text-destructive" : "text-muted-foreground"}`}>{d.maior_atraso} dias</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.etapa === "promessa" && <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">Promessa antiga</span>}
                        {a && <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">Acordo {brl(a.pago_cents)} de {brl(a.total_cents)}</span>}
                        {a && a.dias_atraso > 0 && <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-destructive">Parcela {a.dias_atraso}d atrasada</span>}
                        {a?.prorrogado && <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">Já prorrogado</span>}
                        {d.proxima_acao && <span className="rounded border border-border px-1.5 py-0.5 text-[0.625rem] uppercase text-muted-foreground">Próx. {dataBR(d.proxima_acao)}</span>}
                      </div>
                      {c.id === "atrasado" && a && (
                        !a.prorrogado
                          ? <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" onClick={() => setProrrogar(d)}>Prorrogar (única vez)</Button>
                          : a.dias_atraso > 5 && <Button size="sm" variant="outline" className="mt-2 h-7 w-full border-bronze text-xs text-bronze" onClick={() => onMover(d, "acompanhamento")}>Enviar ao Judicial</Button>
                      )}
                    </article>
                  );
                })}
                {col.length > 80 && <p className="px-2 text-xs text-muted-foreground">+{col.length - 80} — use a busca.</p>}
              </div>
            </section>
          );
        })}
      </div>
      {prorrogar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4" onClick={() => setProrrogar(null)}>
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg">Prorrogar acordo de {prorrogar.nome}</h3>
            <p className="text-sm text-muted-foreground">Só existe uma prorrogação por acordo. Depois dela, se atrasar de novo por mais de 5 dias, o caso vai para o Judicial.</p>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Motivo e nova data combinada" className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setProrrogar(null)}>Cancelar</Button><Button onClick={confirmarProrrogacao} disabled={!motivo.trim()}>Confirmar prorrogação</Button></div>
          </div>
        </div>
      )}
    </>
  );
}

type Kpis = { devedoras: number; vencido_cents: number; hoje: number; atrasadas: number; acordos_gerados: number; acordos_atrasados: number; saldo_acordo_cents: number; previsto_cents: number; realizado_cents: number };
const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export function KpisCobranca({ filtro, onFiltro }: { filtro: string; onFiltro: (f: string) => void }) {
  const [p, setP] = React.useState<DateRange | undefined>(() => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }));
  const de = p?.from ? iso(p.from) : ""; const ate = p?.to ? iso(p.to) : de;
  const q = useQuery({ queryKey: ["cob", "kpis-periodo", de, ate], enabled: !!de, queryFn: async () => { const { data, error } = await rpc("cob_kpis_periodo", { _de: de, _ate: ate }); if (error) throw new Error(error.message); return data as Kpis; } });
  const k = q.data;
  const t = (id: string, r: string, v: string, alerta = false) => (
    <button key={r} onClick={() => id && onFiltro(filtro === id ? "" : id)} className={`rounded-xl border p-4 text-left transition ${id && filtro === id ? "border-primary bg-primary/5" : "border-border bg-card"} ${id ? "hover:border-primary/50" : "cursor-default"}`}>
      <p className="text-xs text-muted-foreground">{r}</p><p className={`mt-1 font-mono text-xl tabular-nums ${alerta ? "text-destructive" : ""}`}>{v}</p>
    </button>
  );
  const pct = k && k.previsto_cents > 0 ? Math.round((k.realizado_cents / k.previsto_cents) * 100) : null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Acordos e previsto × realizado no período</p><DateRangeField className="w-72" value={p} onChange={setP} /></div>
      {q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-9">
          {t("", "Saldo vencido", k ? brl(Number(k.vencido_cents)) : "…")}
          {t("", "Em acordo (a receber)", k ? brl(Number(k.saldo_acordo_cents)) : "…")}
          {t("", "Devedoras", k ? String(k.devedoras) : "…")}
          {t("hoje", "Ações de hoje", k ? String(k.hoje) : "…")}
          {t("atrasadas", "Ações atrasadas", k ? String(k.atrasadas) : "…", !!k && k.atrasadas > 0)}
          {t("", "Acordos gerados", k ? String(k.acordos_gerados) : "…")}
          {t("acordos_atrasados", "Acordos atrasados", k ? String(k.acordos_atrasados) : "…", !!k && k.acordos_atrasados > 0)}
          {t("", "Previsto em acordos", k ? brl(Number(k.previsto_cents)) : "…")}
          {t("", `Realizado${pct != null ? ` · ${pct}%` : ""}`, k ? brl(Number(k.realizado_cents)) : "…")}
        </div>
      )}
    </section>
  );
}

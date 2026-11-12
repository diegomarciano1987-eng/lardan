/**
 * Acertos do representante (0246). A maleta fica ~42 dias na rua desde o recebimento; perto disso
 * ele se prepara para o acerto. Aqui: acertos a fazer no período (com as atrasadas), acertos feitos,
 * a venda bruta das consultoras dele e as remessas em nome dele ou das praças dele — cada uma com
 * as "informações para o acerto" que a montagem escreveu e o checklist digital "acerto feito".
 */
import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Circle, MessageCircle, PackageX } from "lucide-react";
import { brl, repAcertoMarcar, repAcertos, repRemessaInformacoes, repRemessas, type RepRemessa } from "@/lib/representante";
import { wa } from "@/components/representante/AcoesRepresentante";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const br = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const MOTIVO: Record<string, string> = { inadimplente: "Inadimplente", pausa: "Pediu pausa", sem_estoque: "Sem peças/estoque", desistiu: "Desistiu", outro: "Outro" };

type Periodo = "semana" | "proxima" | "passada" | "mes" | "outro";
function intervalo(p: Periodo, de: string, ate: string): [string, string] {
  const h = new Date(); h.setHours(12, 0, 0, 0);
  const seg = new Date(h); seg.setDate(h.getDate() - ((h.getDay() + 6) % 7));
  const dom = (d: Date) => { const x = new Date(d); x.setDate(d.getDate() + 6); return x; };
  if (p === "semana") return [iso(seg), iso(dom(seg))];
  if (p === "proxima") { const s = new Date(seg); s.setDate(seg.getDate() + 7); return [iso(s), iso(dom(s))]; }
  if (p === "passada") { const s = new Date(seg); s.setDate(seg.getDate() - 7); return [iso(s), iso(dom(s))]; }
  if (p === "mes") return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(new Date(h.getFullYear(), h.getMonth() + 1, 0))];
  return [de, ate];
}

function SeletorPeriodo({ p, setP, de, ate, setDe, setAte }: { p: Periodo; setP: (v: Periodo) => void; de: string; ate: string; setDe: (v: string) => void; setAte: (v: string) => void }) {
  const ops: [Periodo, string][] = [["semana", "Esta semana"], ["proxima", "Próxima semana"], ["passada", "Semana passada"], ["mes", "Este mês"], ["outro", "Escolher datas"]];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ops.map(([id, r]) => (
          <button key={id} type="button" onClick={() => setP(id)}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-sm ${p === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>{r}</button>
        ))}
      </div>
      {p === "outro" && (
        <div className="flex gap-2">
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm" aria-label="De" />
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm" aria-label="Até" />
        </div>
      )}
    </div>
  );
}
function usePeriodo() {
  const [p, setP] = React.useState<Periodo>("semana");
  const [de, setDe] = React.useState(() => intervalo("semana", "", "")[0]);
  const [ate, setAte] = React.useState(() => intervalo("semana", "", "")[1]);
  const [a, b] = intervalo(p, de, ate);
  return { p, setP, de, ate, setDe, setAte, a, b };
}

function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: string; sub?: string; tom?: "alerta" | undefined }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tom === "alerta" ? "text-destructive" : ""}`}>{valor}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function AcertosRepresentante({ rep }: { rep: string }) {
  const per = usePeriodo();
  const q = useQuery({ queryKey: ["rep", rep, "acertos", per.a, per.b], queryFn: () => repAcertos(rep, per.a, per.b), placeholderData: keepPreviousData });
  const [aba, setAba] = React.useState<"fazer" | "feitos" | "remessas">("fazer");
  const d = q.data;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Acertos e cobranças</h2>
      <SeletorPeriodo {...per} />
      <p className="text-xs text-muted-foreground">Período {br(per.a)} a {br(per.b)}</p>
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Acertos a fazer" valor={d ? String(d.a_fazer_qtd) : "—"} sub={d && d.atrasados_qtd ? `${d.atrasados_qtd} atrasado(s)` : "até o fim do período"} tom={d && d.atrasados_qtd ? "alerta" : undefined} />
        <Kpi rotulo="Acertos feitos" valor={d ? String(d.feitos_qtd) : "—"} sub="no período" />
        <Kpi rotulo="Venda bruta" valor={d ? brl(d.venda_bruta_cents) : "—"} sub="vendido nos acertos do período" />
        <Kpi rotulo="Remessas" valor={d ? String(d.remessas.length) : "—"} sub="suas e das suas praças" />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1 text-sm" role="tablist">
        {([["fazer", "A fazer"], ["feitos", "Feitos"], ["remessas", "Remessas"]] as const).map(([id, r]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            className={`rounded-full py-2.5 ${aba === id ? "bg-card font-semibold shadow-sm" : "text-muted-foreground"}`}>{r}</button>
        ))}
      </div>

      {aba === "fazer" && (
        <ul className="space-y-3">
          {d?.a_fazer.length === 0 && <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum acerto até o fim do período.</li>}
          {d?.a_fazer.map((m) => (
            <li key={`${m.cycle_id ?? m.maleta}-${m.consultora}`} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{m.consultora}</p>
                  <p className="text-xs text-muted-foreground">{m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} · {m.pecas} peças · {brl(m.valor_cents)}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${m.vencida ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                  {m.vencida ? `Atrasado ${Math.abs(m.dias ?? 0)}d` : m.dias === 0 ? "Hoje" : `Acerto ${br(m.acerto)}`}
                </span>
              </div>
              {m.info_acerto && (
                <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <strong>Para o acerto:</strong> {m.info_acerto}{m.info_por ? <span className="block text-xs opacity-70">— {m.info_por}</span> : null}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <a href={wa(m.whatsapp, `Olá, ${(m.consultora.split(" ")[0] ?? "")}! Vamos combinar o acerto da sua maleta?`)} target="_blank" rel="noreferrer"
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border text-sm"><MessageCircle className="size-4" /> Combinar acerto</a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {aba === "feitos" && (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {d?.feitos.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nenhum acerto fechado no período.</li>}
          {d?.feitos.map((f) => (
            <li key={f.cycle_id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0"><p className="truncate font-medium">{f.consultora}</p><p className="text-xs text-muted-foreground">{f.maleta} · {br(f.data)}</p></div>
              <div className="text-right"><p className="font-semibold tabular-nums">{brl(f.vendido_cents)}</p><p className="text-xs text-muted-foreground">a pagar {brl(f.pagar_cents)}</p></div>
            </li>
          ))}
        </ul>
      )}

      {aba === "remessas" && <ListaRemessas rep={rep} remessas={d?.remessas ?? []} />}
    </div>
  );
}

/** "Informações da remessa": as remessas do período e, ao abrir, cada consultora com a informação e o checklist. */
export function InformacoesRemessaRep({ rep }: { rep: string }) {
  const per = usePeriodo();
  const q = useQuery({ queryKey: ["rep", rep, "remessas", per.a, per.b], queryFn: () => repRemessas(rep, per.a, per.b), placeholderData: keepPreviousData });
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Informações da remessa</h2>
      <p className="text-sm text-muted-foreground">O que a Lardan anotou na montagem para cada consultora: informações para o acerto e por que alguém ficou sem maleta. Marque cada acerto conforme for fazendo.</p>
      <SeletorPeriodo {...per} />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      <ListaRemessas rep={rep} remessas={q.data ?? []} />
    </div>
  );
}

function ListaRemessas({ rep, remessas }: { rep: string; remessas: RepRemessa[] }) {
  const [aberta, setAberta] = React.useState<string | null>(null);
  if (!remessas.length) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhuma remessa no período.</p>;
  return (
    <ul className="space-y-3">
      {remessas.map((r) => (
        <li key={r.id} className="rounded-2xl border border-border bg-card">
          <button type="button" onClick={() => setAberta(aberta === r.id ? null : r.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
            <div className="min-w-0">
              <p className="font-semibold">Remessa {r.numero} · {r.praca}</p>
              <p className="text-xs text-muted-foreground">Emissão {br(r.data_emissao)} · acerto {br(r.data_acerto)} · {r.maletas} maletas · {brl(r.valor_cents)}{r.em_meu_nome ? "" : " · da sua praça"}</p>
              <p className="mt-1 text-xs font-medium text-primary">{r.acertos_feitos} de {r.maletas} acertos feitos{r.informacoes ? ` · ${r.informacoes} informação(ões)` : ""}</p>
            </div>
            <ChevronDown className={`size-5 shrink-0 transition-transform ${aberta === r.id ? "rotate-180" : ""}`} />
          </button>
          {aberta === r.id && <Checklist rep={rep} remessa={r.id} />}
        </li>
      ))}
    </ul>
  );
}

function Checklist({ rep, remessa }: { rep: string; remessa: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "remessa-info", remessa], queryFn: () => repRemessaInformacoes(rep, remessa) });
  const marcar = useMutation({
    mutationFn: (v: { party: string; feito: boolean }) => repAcertoMarcar(rep, remessa, v.party, v.feito),
    onSuccess: (r) => {
      toast.success(r.feito ? `Acerto feito (${r.feitos} de ${r.total}).` : "Desmarcado.");
      void qc.invalidateQueries({ queryKey: ["rep", rep, "remessa-info", remessa] });
      void qc.invalidateQueries({ queryKey: ["rep", rep, "remessas"] });
      void qc.invalidateQueries({ queryKey: ["rep", rep, "acertos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (q.isLoading) return <p className="px-4 pb-4 text-sm text-muted-foreground">Carregando…</p>;
  if (q.error) return <p className="px-4 pb-4 text-sm text-destructive">{(q.error as Error).message}</p>;
  const itens = q.data?.itens ?? [];
  const com = itens.filter((i) => i.tem_maleta);
  const sem = itens.filter((i) => !i.tem_maleta);
  return (
    <div className="space-y-3 border-t border-border p-4">
      {com.length > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label="Progresso dos acertos">
          <div className="h-full bg-primary transition-all" style={{ width: `${(100 * com.filter((i) => i.feito_em).length) / com.length}%` }} />
        </div>
      )}
      <ul className="space-y-2">
        {com.map((i) => (
          <li key={i.party_id} className={`rounded-xl border p-3 ${i.feito_em ? "border-primary/40 bg-primary/5" : "border-border"}`}>
            <button type="button" disabled={marcar.isPending} onClick={() => marcar.mutate({ party: i.party_id, feito: !i.feito_em })}
              className="flex w-full items-center gap-3 text-left" aria-pressed={!!i.feito_em}>
              {i.feito_em ? <CheckCircle2 className="size-7 shrink-0 text-primary" /> : <Circle className="size-7 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-medium ${i.feito_em ? "line-through opacity-70" : ""}`}>{i.nome}</span>
                <span className="block text-xs text-muted-foreground">{i.maleta}{i.acerto ? ` · acerto ${br(i.acerto)}` : ""}{i.feito_em ? ` · feito em ${new Date(i.feito_em).toLocaleDateString("pt-BR")}` : ""}</span>
              </span>
            </button>
            {i.info_acerto && <p className="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><strong>Para o acerto:</strong> {i.info_acerto}</p>}
          </li>
        ))}
      </ul>
      {sem.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Sem maleta nesta remessa</p>
          {sem.map((i) => (
            <div key={i.party_id} className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3">
              <PackageX className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium">{i.nome}</p>
                <p className="text-sm">{i.sem_maleta_motivo ? MOTIVO[i.sem_maleta_motivo] ?? i.sem_maleta_motivo : "Não montou"}{i.info_acerto ? ` — ${i.info_acerto}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

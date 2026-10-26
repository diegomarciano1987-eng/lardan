/**
 * 0160 — Trabalho de campo do representante:
 *  · Maletas da carteira (alerta de vencida) e o ACERTO EM CAMPO: lê a devolução, o sistema calcula venda e comissão,
 *    fecha o acerto e já cobra (link/Pix ou dinheiro com recibo);
 *  · Agenda de visitas com registro de cada visita (entra no histórico da consultora);
 *  · Dinheiro recebido (recibos) no período.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CalendarPlus, CheckCircle2, Printer, ScanBarcode } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateField } from "@/components/premium/DateField";
import { abrirPreBaixa, lerPreBaixa } from "@/lib/pre-baixa";
import {
  brl, dataBR, repAcertoCampoDevolucao, repAcertoFechar, repAgenda, repConsultoras, repMaletasCarteira, repRecibos, repVisitaAgendar, repVisitaRegistrar,
  type MaletaCarteira, type RepCobranca, type Visita,
} from "@/lib/representante";
import { imprimirRecibo } from "@/lib/recibo-representante";
import { CobrarParcela } from "@/components/representante/AcoesRepresentante";

const SIT: Record<MaletaCarteira["pre_baixa"], string> = {
  sem_pre_baixa: "Acerto não começou", aberta: "Acerto em lançamento", aguardando_pagamento: "Acerto fechado · falta pagar",
  aguardando_conferencia: "Pago · maleta volta para conferência", encerrada: "Acerto encerrado", pendencia: "Acerto com pendência", cancelada: "Cancelado",
  smalldata: "Maleta do SmallData · acerto pelo SmallData",
};

export function MaletasCarteira({ rep }: { rep: string }) {
  const q = useQuery({ queryKey: ["rep", rep, "maletas-carteira"], queryFn: () => repMaletasCarteira(rep) });
  const [acerto, setAcerto] = React.useState<MaletaCarteira | null>(null);
  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  const lista = q.data ?? [];
  const vencidas = lista.filter((m) => m.vencida && m.pre_baixa !== "encerrada").length;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Maletas da carteira <span className="text-sm font-normal text-muted-foreground">· {lista.length} com as consultoras</span></h2>
        {vencidas > 0 && <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive"><AlertTriangle className="size-3.5" /> {vencidas} com acerto vencido</span>}
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!q.isLoading && lista.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma maleta com as consultoras da sua carteira agora.</p>}
      <ul className="divide-y divide-border">
        {lista.map((m) => (
          <li key={m.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${m.vencida && m.pre_baixa !== "encerrada" ? "rounded-xl bg-destructive/5 px-3" : ""}`}>
            <div className="min-w-0">
              <p className="truncate font-medium">{m.consultora}</p>
              <p className="text-xs text-muted-foreground">Maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} · {m.pecas} peças · {brl(m.valor_cents)}</p>
              <p className={`text-xs ${m.vencida ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                {m.acerto ? (m.vencida ? `Acerto venceu em ${dataBR(m.acerto)} (${Math.abs(m.dias ?? 0)} dia(s))` : `Acerto em ${dataBR(m.acerto)} · faltam ${m.dias} dia(s)`) : "Sem data de acerto"} · {SIT[m.pre_baixa]}
                {m.origem === "campo" ? " (feito em campo)" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {m.installment_id && (m.saldo_cents ?? 0) > 0 && (
                <CobrarParcela rep={rep} rotulo={`Cobrar ${brl(m.saldo_cents ?? 0)}`}
                  c={{ installment_id: m.installment_id, numero: `acerto ${m.maleta}`, vencimento: m.acerto ?? new Date().toISOString().slice(0, 10), saldo_cents: m.saldo_cents ?? 0, party_id: m.party_id, display_name: m.consultora, code: "" }} />
              )}
              {m.fonte === "lardan" && (m.pre_baixa === "sem_pre_baixa" || m.pre_baixa === "aberta") && (
                <button type="button" onClick={() => setAcerto(m)} className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><ScanBarcode className="size-3.5" /> Acerto em campo</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <AcertoCampo rep={rep} maleta={acerto} onClose={() => setAcerto(null)} />
    </section>
  );
}

function AcertoCampo({ rep, maleta, onClose }: { rep: string; maleta: MaletaCarteira | null; onClose: () => void }) {
  const qc = useQueryClient();
  const cycle = maleta?.cycle_id ?? "";  // só maleta Lardan abre o acerto em campo
  const pb = useQuery({ queryKey: ["rep", "campo", cycle], queryFn: async () => { await abrirPreBaixa(cycle); return lerPreBaixa(cycle); }, enabled: !!maleta });
  const [lidas, setLidas] = React.useState<Record<string, number>>({});
  const [codigo, setCodigo] = React.useState("");
  const [calc, setCalc] = React.useState<Awaited<ReturnType<typeof repAcertoCampoDevolucao>> | null>(null);
  const [fechado, setFechado] = React.useState<{ installment_id: string | null; valor_pagar_cents: number } | null>(null);
  const campo = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setLidas({}); setCalc(null); setFechado(null); setCodigo(""); }, [cycle]);
  const leituras = Object.entries(lidas).filter(([, n]) => n > 0).map(([variant_id, qtd]) => ({ variant_id, qtd }));
  const calcular = useMutation({ mutationFn: () => repAcertoCampoDevolucao(cycle, leituras), onSuccess: setCalc, onError: (e: Error) => toast.error(e.message) });
  const fechar = useMutation({
    mutationFn: () => repAcertoFechar(cycle),
    onSuccess: (r) => { setFechado(r); toast.success("Acerto fechado. Agora é só receber."); void qc.invalidateQueries({ queryKey: ["rep"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = pb.data;
  const ler = (e: React.FormEvent) => {
    e.preventDefault();
    const t = codigo.trim().toUpperCase();
    setCodigo(""); campo.current?.focus();
    if (!t || !d) return;
    const it = d.itens.find((i) => [i.barcode, i.sku].some((x) => x && x.toUpperCase() === t));
    if (!it) { toast.error(`Código ${t} não é desta maleta.`); return; }
    const atual = lidas[it.variant_id] ?? 0;
    if (atual >= it.enviada) { toast.error(`Já leu as ${it.enviada} unidade(s) de ${it.produto}.`); return; }
    setLidas({ ...lidas, [it.variant_id]: atual + 1 }); setCalc(null);
  };
  const devolvidas = leituras.reduce((a, l) => a + l.qtd, 0);
  const enviadas = d?.itens.reduce((a, i) => a + i.enviada, 0) ?? 0;
  return (
    <Dialog open={!!maleta} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[94vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Acerto em campo · {maleta?.consultora.split(" ")[0]}</DialogTitle>
          <DialogDescription>Leia o código de cada peça que VOLTOU. O que não voltar conta como vendido, pelo preço gravado na remessa. As vendas pagas pelo app já entram sozinhas.</DialogDescription>
        </DialogHeader>
        {!d ? <p className="text-sm text-muted-foreground">{pb.isLoading ? "Carregando a maleta…" : pb.error ? (pb.error as Error).message : "Maleta sem peças para acertar."}</p> : fechado ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto size-10 text-primary" />
            <p className="text-lg font-semibold">A pagar: {brl(fechado.valor_pagar_cents)}</p>
            {fechado.installment_id && fechado.valor_pagar_cents > 0 ? (
              <CobrarParcela rep={rep} rotulo="Receber agora (link, Pix, dinheiro ou cheque)"
                c={{ installment_id: fechado.installment_id, numero: `acerto ${maleta?.maleta ?? ""}`, vencimento: new Date().toISOString().slice(0, 10), saldo_cents: fechado.valor_pagar_cents, party_id: maleta!.party_id, display_name: maleta!.consultora, code: "" } satisfies RepCobranca} />
            ) : <p className="text-sm text-muted-foreground">Nada a pagar: as clientes já pagaram à Lardan o que ela devia.</p>}
            <p className="text-xs text-muted-foreground">A maleta volta para a Lardan e a equipe confere com o que você leu.</p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <form onSubmit={ler} className="flex gap-2">
              <label className="flex flex-1 items-center gap-2 rounded-xl border border-border px-3">
                <ScanBarcode aria-hidden className="size-4 text-muted-foreground" />
                <input ref={campo} autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código da peça que voltou" className="h-11 flex-1 bg-transparent outline-none" />
              </label>
              <button type="submit" className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Ler</button>
            </form>
            <p className="text-xs text-muted-foreground">Voltaram {devolvidas} de {enviadas} peça(s).</p>
            <ul className="max-h-64 divide-y divide-border overflow-auto rounded-xl border border-border">
              {d.itens.map((i) => {
                const l = lidas[i.variant_id] ?? 0;
                return (
                  <li key={i.variant_id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0"><span className="block truncate">{i.produto}</span><span className="text-xs text-muted-foreground">{i.sku ?? i.barcode ?? ""} · {brl(i.preco_cents)}{i.app ? ` · ${i.app} paga(s) no app` : ""}</span></span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <button type="button" disabled={!l} onClick={() => { setLidas({ ...lidas, [i.variant_id]: l - 1 }); setCalc(null); }} className="grid size-8 place-items-center rounded-full border border-border disabled:opacity-30" aria-label="Tirar uma leitura">−</button>
                      <span className="w-14 text-center text-xs">voltou {l}/{i.enviada}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <button type="button" disabled={calcular.isPending} onClick={() => calcular.mutate()} className="w-full rounded-xl border border-primary px-4 py-2.5 font-semibold text-primary">Calcular venda e comissão</button>
            {calc && (
              <div className="space-y-1 rounded-xl bg-muted px-4 py-3">
                <p className="flex justify-between"><span>Vendido</span><strong className="tabular-nums">{brl(calc.vendido_cents)}</strong></p>
                <p className="flex justify-between"><span>Comissão ({Number(calc.comissao_pct)}%)</span><span className="tabular-nums">− {brl(calc.comissao_cents)}</span></p>
                {Number(calc.recebido_lardan_cents ?? 0) > 0 && <p className="flex justify-between"><span>Clientes já pagaram à Lardan</span><span className="tabular-nums">− {brl(Number(calc.recebido_lardan_cents))}</span></p>}
                <p className="flex justify-between border-t border-border pt-1 text-base"><span>A pagar</span><strong className="tabular-nums">{brl(Math.max(calc.valor_pagar_cents, 0))}</strong></p>
                <button type="button" disabled={fechar.isPending} onClick={() => fechar.mutate()} className="mt-2 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                  {fechar.isPending ? "Fechando…" : "Fechar o acerto e receber"}
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── agenda ─────────────
const ROT_VISITA: Record<Visita["status"], string> = { agendada: "Agendada", realizada: "Realizada", nao_encontrada: "Não encontrada", cancelada: "Cancelada" };

export function AgendaVisitas({ rep }: { rep: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rep", rep, "agenda"], queryFn: () => repAgenda(rep) });
  const [nova, setNova] = React.useState(false);
  const [registrar, setRegistrar] = React.useState<Visita | null>(null);
  const hoje = new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  const lista = q.data ?? [];
  const proximas = lista.filter((v) => v.status === "agendada");
  const feitas = lista.filter((v) => v.status !== "agendada").reverse();
  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Agenda de visitas</h2>
          <button type="button" onClick={() => setNova(true)} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><CalendarPlus className="size-4" /> Agendar visita</button>
        </div>
        {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        {proximas.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma visita agendada.</p>}
        <ul className="divide-y divide-border">
          {proximas.map((v) => {
            const dia = new Date(v.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            const ehHoje = v.quando.slice(0, 10) === hoje;
            return (
              <li key={v.id} className={`flex items-center justify-between gap-3 py-3 ${v.atrasada ? "rounded-xl bg-destructive/5 px-3" : ""}`}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.nome}</p>
                  <p className={`text-xs ${v.atrasada ? "font-semibold text-destructive" : ehHoje ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                    <CalendarClock className="mr-1 inline size-3.5" />{dia}{v.atrasada ? " · não registrada" : ehHoje ? " · hoje" : ""} · {v.motivo}
                  </p>
                </div>
                <button type="button" onClick={() => setRegistrar(v)} className="shrink-0 rounded-full border border-primary px-3 py-1.5 text-xs font-semibold text-primary">Registrar</button>
              </li>
            );
          })}
        </ul>
      </section>
      {feitas.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-border bg-card p-5 md:p-6">
          <h3 className="text-sm font-semibold">Visitas registradas</h3>
          <ul className="space-y-2 text-sm">
            {feitas.slice(0, 30).map((v) => (
              <li key={v.id} className="rounded-xl border border-border px-3 py-2">
                <p className="font-medium">{v.nome} · {ROT_VISITA[v.status]} · {new Date(v.quando).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
                {v.resultado && <p className="text-xs text-muted-foreground">{v.resultado}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <NovaVisita rep={rep} aberto={nova} onClose={() => setNova(false)} onOk={() => { setNova(false); void qc.invalidateQueries({ queryKey: ["rep", rep, "agenda"] }); }} />
      <RegistrarVisita visita={registrar} onClose={() => setRegistrar(null)} onOk={() => { setRegistrar(null); void qc.invalidateQueries({ queryKey: ["rep", rep, "agenda"] }); }} />
      <RecibosResumo rep={rep} />
    </div>
  );
}

function NovaVisita({ rep, aberto, onClose, onOk }: { rep: string; aberto: boolean; onClose: () => void; onOk: () => void }) {
  const [busca, setBusca] = React.useState("");
  const [alvo, setAlvo] = React.useState<{ id: string; nome: string } | null>(null);
  const [data, setData] = React.useState<Date | undefined>();
  const [hora, setHora] = React.useState("09:00");
  const [motivo, setMotivo] = React.useState("Acerto e cobrança");
  const cons = useQuery({ queryKey: ["rep", rep, "visita-busca", busca], queryFn: () => repConsultoras(rep, busca, "todas", 1), enabled: aberto && busca.trim().length >= 2 });
  const salvar = useMutation({
    mutationFn: () => {
      if (!alvo) throw new Error("Escolha a consultora.");
      if (!data) throw new Error("Escolha o dia.");
      const [h, m] = hora.split(":").map(Number);
      const quando = new Date(data.getFullYear(), data.getMonth(), data.getDate(), h ?? 9, m ?? 0);
      return repVisitaAgendar(rep, { party: alvo.id }, quando.toISOString(), motivo);
    },
    onSuccess: () => { toast.success("Visita agendada."); setAlvo(null); setBusca(""); setData(undefined); onOk(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Agendar visita</DialogTitle><DialogDescription>Só consultoras da sua carteira.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          {alvo ? (
            <p className="flex items-center justify-between rounded-xl border border-border px-3 py-2"><strong>{alvo.nome}</strong><button type="button" className="text-xs underline" onClick={() => setAlvo(null)}>trocar</button></p>
          ) : (
            <>
              <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código da consultora" className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" />
              <ul className="max-h-48 divide-y divide-border overflow-auto">
                {cons.data?.itens.map((c) => (
                  <li key={c.id}><button type="button" onClick={() => setAlvo({ id: c.id, nome: c.display_name })} className="w-full py-2 text-left hover:bg-muted/40">{c.display_name} <span className="text-xs text-muted-foreground">· {c.code} · {c.cidade ?? ""}</span></button></li>
                ))}
              </ul>
            </>
          )}
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Dia</span><DateField value={data} onChange={setData} /></label>
            <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Hora</span><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
          </div>
          <label className="block"><span className="mb-1 block text-xs text-muted-foreground">Motivo</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 outline-none" /></label>
          <button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">Agendar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RegistrarVisita({ visita, onClose, onOk }: { visita: Visita | null; onClose: () => void; onOk: () => void }) {
  const [status, setStatus] = React.useState<"realizada" | "nao_encontrada" | "cancelada">("realizada");
  const [resultado, setResultado] = React.useState("");
  React.useEffect(() => { setStatus("realizada"); setResultado(""); }, [visita?.id]);
  const salvar = useMutation({
    mutationFn: () => repVisitaRegistrar(visita!.id, status, resultado),
    onSuccess: () => { toast.success("Visita registrada. Já aparece no histórico da consultora."); onOk(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const chip = (a: boolean) => `rounded-full border px-3 py-1.5 text-xs ${a ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`;
  return (
    <Dialog open={!!visita} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Como foi a visita?</DialogTitle><DialogDescription>{visita?.nome} · {visita?.motivo}</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            {(["realizada", "nao_encontrada", "cancelada"] as const).map((s) => <button key={s} type="button" className={chip(status === s)} onClick={() => setStatus(s)}>{ROT_VISITA[s]}</button>)}
          </div>
          <textarea value={resultado} onChange={(e) => setResultado(e.target.value)} rows={3} placeholder="O que aconteceu e o que ficou combinado" className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none" />
          <button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">Salvar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecibosResumo({ rep }: { rep: string }) {
  const q = useQuery({ queryKey: ["rep", rep, "recibos"], queryFn: () => repRecibos(rep, 30) });
  if (!q.data || q.data.itens.length === 0) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h3 className="text-sm font-semibold">Dinheiro recebido nos últimos 30 dias: {brl(q.data.total_cents)}</h3>
      <p className="text-xs text-muted-foreground">Fica na conta "Retido Representante" até o repasse à Lardan.</p>
      <ul className="divide-y divide-border text-sm">
        {q.data.itens.map((r) => (
          <li key={r.numero} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 truncate">Nº {r.numero} · {r.consultora} · {new Date(r.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums">{brl(r.valor_cents)}
              <button type="button" onClick={() => imprimirRecibo(r)} className="grid size-8 place-items-center rounded-full border border-border" aria-label="Imprimir recibo"><Printer className="size-3.5" /></button></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

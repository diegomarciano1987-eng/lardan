import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { fetchFinOverviewPeriodo, fetchFinAccounts } from "@/lib/financeiro";
import { fetchLiquidacoes, fetchPagarReceber } from "@/lib/financeiro-unificado";
import { cn } from "@/lib/utils";

type Escala = "dia" | "semana" | "mes";
type Card = "saldo" | "recebido" | "resultado" | "vencido";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const br = (s: string) => s.split("-").reverse().join("/");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function intervalo(escala: Escala, ancora: Date) {
  const a = new Date(ancora.getFullYear(), ancora.getMonth(), ancora.getDate());
  if (escala === "dia") return { de: iso(a), ate: iso(a), rotulo: a.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }) };
  if (escala === "semana") {
    const ini = new Date(a);
    ini.setDate(a.getDate() - ((a.getDay() + 6) % 7));
    const fim = new Date(ini);
    fim.setDate(ini.getDate() + 6);
    return { de: iso(ini), ate: iso(fim), rotulo: `Semana de ${br(iso(ini))} a ${br(iso(fim))}` };
  }
  const ini = new Date(a.getFullYear(), a.getMonth(), 1);
  const fim = new Date(a.getFullYear(), a.getMonth() + 1, 0);
  return { de: iso(ini), ate: iso(fim), rotulo: `${MESES[a.getMonth()]} de ${a.getFullYear()}` };
}

function mover(escala: Escala, ancora: Date, passo: number) {
  const d = new Date(ancora);
  if (escala === "dia") d.setDate(d.getDate() + passo);
  else if (escala === "semana") d.setDate(d.getDate() + 7 * passo);
  else d.setMonth(d.getMonth() + passo, 1);
  return d;
}

function Kpi({ rotulo, valor, detalhe, tom, onClick, carregando }: { rotulo: string; valor: string; detalhe: string; tom?: "alerta" | undefined; onClick: () => void; carregando: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ledger-panel group px-5 py-4 text-left transition-all hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-bronze"
    >
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-ledger-muted">{rotulo}</p>
      {carregando ? (
        <Skeleton className="mt-2 h-8 w-40" />
      ) : (
        <p className={cn("valor-num mt-1.5 text-[1.6rem] font-semibold leading-none", tom === "alerta" ? "text-rose-deep" : "text-ledger-text")}>{valor}</p>
      )}
      <p className="mt-1.5 text-xs text-ledger-muted">{detalhe}</p>
      <p className="mt-2 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-bronze opacity-70 group-hover:opacity-100">Ver composição →</p>
    </button>
  );
}

export function PulsoCards() {
  const [escala, setEscala] = useState<Escala>("mes");
  const [ancora, setAncora] = useState(() => new Date());
  const [aberto, setAberto] = useState<Card | null>(null);
  const per = useMemo(() => intervalo(escala, ancora), [escala, ancora]);
  const hoje = iso(new Date());

  const ov = useQuery({ queryKey: ["pulso-ov", per.de, per.ate], queryFn: () => fetchFinOverviewPeriodo(per.de, per.ate) });
  const d = ov.data;
  const resultado = (d?.recebido_periodo_cents ?? 0) - (d?.pago_periodo_cents ?? 0);

  return (
    <div className="space-y-3">
      <div className="ledger-panel flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="inline-flex rounded-[10px] border border-line bg-surface p-1" role="tablist" aria-label="Escala do período">
          {(["dia", "semana", "mes"] as Escala[]).map((e) => (
            <button
              key={e}
              type="button"
              role="tab"
              aria-selected={escala === e}
              onClick={() => { setEscala(e); setAncora(new Date()); }}
              className={cn("rounded-[8px] px-4 py-1.5 text-sm font-semibold transition-colors", escala === e ? "bg-ledger-text text-warm-ivory" : "text-ledger-muted hover:text-ledger-text")}
            >
              {e === "dia" ? "Dia" : e === "semana" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Período anterior" onClick={() => setAncora(mover(escala, ancora, -1))} className="admin-btn px-2"><ChevronLeft className="size-4" /></button>
          <button type="button" aria-label="Próximo período" onClick={() => setAncora(mover(escala, ancora, 1))} className="admin-btn px-2"><ChevronRight className="size-4" /></button>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold capitalize text-ledger-text">{per.rotulo}</p>
          <p className="valor-num text-xs text-ledger-muted">{br(per.de)} a {br(per.ate)}</p>
        </div>
        <button type="button" onClick={() => setAncora(new Date())} className="ml-auto text-xs font-semibold text-bronze hover:underline">Voltar para hoje</button>
      </div>

      {ov.isError ? <p className="text-sm text-rose-deep">Não foi possível ler os valores do período.</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi carregando={!d} onClick={() => setAberto("saldo")} rotulo={`Saldo em contas · ${d ? br(d.data_corte_saldo) : "—"}`} valor={formatBRLFromCents(d?.saldo_contas_cents ?? 0)} detalhe={d && d.data_corte_saldo < per.ate ? "Posição de hoje; datas futuras não somam" : "Todas as contas e caixas na data"} />
        <Kpi carregando={!d} onClick={() => setAberto("recebido")} rotulo="Recebido no período" valor={formatBRLFromCents(d?.recebido_periodo_cents ?? 0)} detalhe={`${formatInt(d?.recebido_qtd ?? 0)} recebimento(s) · pago ${formatBRLFromCents(d?.pago_periodo_cents ?? 0)}`} />
        <Kpi carregando={!d} onClick={() => setAberto("resultado")} rotulo="Resultado de caixa no período" valor={formatBRLFromCents(resultado)} tom={resultado < 0 ? "alerta" : undefined} detalhe={`Entrou ${formatBRLFromCents(d?.recebido_periodo_cents ?? 0)} · saiu ${formatBRLFromCents(d?.pago_periodo_cents ?? 0)}`} />
        <Kpi carregando={!d} onClick={() => setAberto("vencido")} rotulo="Vencido a receber no período" valor={formatBRLFromCents(d?.vencido_receber_cents ?? 0)} tom={(d?.vencido_receber_cents ?? 0) > 0 ? "alerta" : undefined} detalhe={`${formatInt(d?.vencido_receber_qtd ?? 0)} parcela(s) · vencido a pagar ${formatBRLFromCents(d?.vencido_pagar_cents ?? 0)}`} />
      </div>

      <Dialog open={aberto !== null} onOpenChange={(o) => !o && setAberto(null)}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
          {aberto && d ? <Composicao card={aberto} de={per.de} ate={per.ate} hoje={hoje} total={aberto === "saldo" ? d.saldo_contas_cents : aberto === "recebido" ? d.recebido_periodo_cents : aberto === "resultado" ? resultado : d.vencido_receber_cents} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Linha = { id: string; data: string; titulo: string; sub: string; valor: number };

const TITULOS: Record<Card, string> = {
  saldo: "Saldo em contas",
  recebido: "Recebido no período",
  resultado: "Resultado de caixa no período",
  vencido: "Vencido a receber no período",
};

async function todasLiquidacoes(direction: "receivable" | "payable", de: string, ate: string) {
  const rows: Linha[] = [];
  let soma = 0;
  for (let off = 0; ; off += 500) {
    const r = await fetchLiquidacoes({ direction, de, ate, limit: 500, offset: off });
    soma = r.soma_cents;
    for (const x of r.rows) rows.push({ id: x.id, data: x.data, titulo: x.descricao ?? x.referencia ?? "Liquidação", sub: [x.pessoa, x.conta, x.is_reversal ? "Estorno" : null].filter(Boolean).join(" · "), valor: direction === "payable" ? -x.valor_cents : x.valor_cents });
    if (r.rows.length < 500 || rows.length >= r.total) break;
  }
  return { rows, soma: direction === "payable" ? -soma : soma };
}

function Composicao({ card, de, ate, hoje, total }: { card: Card; de: string; ate: string; hoje: string; total: number }) {
  const [busca, setBusca] = useState("");
  const q = useQuery({
    queryKey: ["pulso-comp", card, de, ate],
    queryFn: async (): Promise<{ rows: Linha[]; soma: number; nota: string }> => {
      if (card === "saldo") {
        const contas = await fetchFinAccounts();
        const rows = contas.filter((c) => c.is_active && c.saldo_cents !== 0).map((c) => ({ id: c.id, data: c.ultimo_movimento ?? "", titulo: c.nome, sub: [c.banco, c.previsto_futuro_cents ? `previsto futuro ${formatBRLFromCents(c.previsto_futuro_cents)}` : null].filter(Boolean).join(" · "), valor: c.saldo_cents }));
        return { rows, soma: rows.reduce((s, r) => s + r.valor, 0), nota: `Saldo de cada conta ativa pelo razão até ${br(ate < hoje ? ate : hoje)}.` };
      }
      if (card === "recebido") {
        const r = await todasLiquidacoes("receivable", de, ate);
        return { ...r, nota: "Cada recebimento pela data em que o dinheiro entrou." };
      }
      if (card === "resultado") {
        const [e, s] = await Promise.all([todasLiquidacoes("receivable", de, ate), todasLiquidacoes("payable", de, ate)]);
        return { rows: [...e.rows, ...s.rows].sort((a, b) => a.data.localeCompare(b.data)), soma: e.soma + s.soma, nota: "Entradas menos saídas liquidadas no período, pela data de pagamento." };
      }
      const rows: Linha[] = [];
      let soma = 0;
      for (let off = 0; ; off += 500) {
        const r = await fetchPagarReceber({ natureza: "receber", de, ate, situacao: "vencido", origem: "todas", busca: "", limit: 500, offset: off });
        soma = r.totais.receber.saldo_cents;
        for (const x of r.rows) rows.push({ id: x.id, data: x.vencimento, titulo: `${x.descricao}${x.numero ? ` · parcela ${x.numero}/${x.total_parcelas}` : ""}`, sub: [x.pessoa, x.origem === "asaas" || x.tipo === "cobranca_asaas" ? "Asaas" : x.origem === "importacao" ? "Importação" : "Manual"].filter(Boolean).join(" · "), valor: x.saldo_cents });
        if (r.rows.length < 500 || rows.length >= r.totais.linhas) break;
      }
      return { rows, soma, nota: "Saldo em aberto das parcelas e cobranças vencidas dentro do período." };
    },
  });

  const filtradas = (q.data?.rows ?? []).filter((r) => !busca || `${r.titulo} ${r.sub} ${formatBRLFromCents(r.valor)}`.toLowerCase().includes(busca.toLowerCase()));
  const somaLista = q.data?.rows.reduce((s, r) => s + r.valor, 0) ?? 0;
  const bate = q.data ? somaLista === total : null;

  return (
    <div className="flex max-h-[88vh] flex-col">
      <DialogHeader className="space-y-1 border-b border-line-soft px-6 pb-4 pt-6 text-left">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-bronze">Composição · {br(de)} a {br(ate)}</p>
        <DialogTitle className="font-display text-2xl text-ledger-text">{TITULOS[card]}</DialogTitle>
        <DialogDescription className="text-xs text-ledger-muted">{q.data?.nota ?? "Carregando os lançamentos…"}</DialogDescription>
        <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
          <p className="valor-num text-3xl font-semibold text-ledger-text">{formatBRLFromCents(total)}</p>
          {bate === null ? null : bate ? (
            <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-success">✓ {formatInt(q.data!.rows.length)} lançamento(s) somam exatamente o card</span>
          ) : (
            <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-rose-deep">Lista soma {formatBRLFromCents(somaLista)} — diferença {formatBRLFromCents(total - somaLista)}</span>
          )}
        </div>
      </DialogHeader>
      <div className="border-b border-line-soft px-6 py-3">
        <label className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
          <Search className="size-4 text-ledger-muted" aria-hidden />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição, pessoa, conta ou valor" className="w-full bg-transparent text-base outline-none sm:text-sm" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">
        {q.isLoading ? (
          <div className="space-y-2 py-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : q.isError ? (
          <p className="py-6 text-sm text-rose-deep">Não foi possível carregar a composição.</p>
        ) : filtradas.length === 0 ? (
          <p className="py-6 text-sm text-ledger-muted">Sem dados neste período.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {filtradas.map((r) => (
              <li key={r.id} className="flex items-center gap-4 py-3">
                <span className="valor-num w-20 shrink-0 text-xs text-ledger-muted">{r.data ? br(r.data.slice(0, 10)) : "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ledger-text">{r.titulo}</span>
                  {r.sub ? <span className="block truncate text-xs text-ledger-muted">{r.sub}</span> : null}
                </span>
                <span className={cn("valor-num shrink-0 text-sm font-semibold", r.valor < 0 ? "text-rose-deep" : "text-ledger-text")}>{formatBRLFromCents(r.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {busca && q.data ? (
        <p className="valor-num border-t border-line-soft px-6 py-3 text-xs text-ledger-muted">{formatInt(filtradas.length)} de {formatInt(q.data.rows.length)} · soma filtrada {formatBRLFromCents(filtradas.reduce((s, r) => s + r.valor, 0))}</p>
      ) : null}
    </div>
  );
}

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { ROTULO_ACAO, desfazerAuto, relatorioAuto, type ItemAuto } from "@/lib/asaas-automatico";

const diaSP = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const PERIODOS = [
  { id: "hoje", rotulo: "Hoje", dias: 0 },
  { id: "ontem", rotulo: "Ontem", dias: 1 },
  { id: "7", rotulo: "Últimos 7 dias", dias: 7 },
] as const;
const quando = (d: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));

function Linha({ it, onDesfeito }: { it: ItemAuto; onDesfeito: () => void }) {
  const [abrindo, setAbrindo] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const m = useMutation({
    mutationFn: () => desfazerAuto(it.id, motivo.trim()),
    onSuccess: () => {
      toast.success("Desfeito: baixa estornada e cobrança solta para decisão manual.");
      setAbrindo(false);
      onDesfeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const podeDesfazer = it.acao !== "excecao" && !it.desfeito_em;
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {it.pessoa ?? "Pagador sem cadastro"}
            {it.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {it.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">
            {it.pay} · {it.payment_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${it.payment_date}T12:00:00`)) : "sem data"}
            {it.titulo_numero ? ` · título ${it.titulo_numero}` : ""} · {it.motivo}
          </p>
          {it.desfeito_em ? (
            <p className="mt-1 text-xs font-semibold text-ledger-text">Desfeito em {quando(it.desfeito_em)}: {it.desfeito_motivo}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={it.desfeito_em ? "neutral" : it.acao === "excecao" ? "warning" : "success"}>{ROTULO_ACAO[it.acao]}</StatusBadge>
          <span className="text-sm font-bold tabular-nums text-ledger-text">
            {it.valor_cents != null ? formatBRLFromCents(it.valor_cents) : "—"}
            {it.juros_cents > 0 ? <span className="ml-1 text-xs font-medium text-ledger-muted">(juros {formatBRLFromCents(it.juros_cents)})</span> : null}
          </span>
          {podeDesfazer ? (
            <button type="button" className="admin-btn h-9" onClick={() => setAbrindo((v) => !v)}>
              <Undo2 aria-hidden className="mr-1 inline size-4" /> Desfazer
            </button>
          ) : null}
        </div>
      </div>
      {abrindo ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className="h-10 min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne"
          />
          <button type="button" className="admin-btn-primary h-10" disabled={motivo.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Desfazendo…" : "Confirmar desfazer"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** 0285 — relatório do que o Asaas lançou sozinho, com desfazer e a fila de exceção. */
export function AsaasAutomatico() {
  const [periodo, setPeriodo] = React.useState<(typeof PERIODOS)[number]["id"]>("hoje");
  const qc = useQueryClient();
  const p = PERIODOS.find((x) => x.id === periodo)!;
  const hoje = diaSP();
  const de = diaSP(new Date(Date.now() - p.dias * 86_400_000));
  const ate = p.id === "ontem" ? de : hoje;
  const q = useQuery({ queryKey: ["asaas-automatico", de, ate], queryFn: () => relatorioAuto(de, ate), staleTime: 30_000 });
  const d = q.data;
  const feitos = (d?.itens ?? []).filter((i) => i.acao !== "excecao");
  const excecoes = (d?.itens ?? []).filter((i) => i.acao === "excecao" && !i.desfeito_em);
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-automatico"] });
    void qc.invalidateQueries({ queryKey: ["asaas-saude"] });
  };
  return (
    <Panel
      title="Asaas automático"
      action={
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Período">
          {PERIODOS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={periodo === x.id}
              onClick={() => setPeriodo(x.id)}
              className={`h-9 rounded-[10px] px-3 text-sm font-semibold ${periodo === x.id ? "bg-asaas text-asaas-foreground" : "border border-line bg-surface text-ledger-text"}`}
            >
              {x.rotulo}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? <p className="text-sm text-ledger-muted">Carregando…</p> : null}
      {q.error ? <p className="text-sm font-medium text-ledger-text">{(q.error as Error).message}</p> : null}
      {d ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-sm text-ledger-text">
            <StatusBadge tone={d.config?.ligado ? "success" : "neutral"}>{d.config?.ligado ? "Ligado" : "Desligado"}</StatusBadge>
            <span>
              A cada 10 minutos: avisos da fila, Pix e faturas recebidos. Juros automáticos até{" "}
              {formatBRLFromCents(d.config?.juros_max_cents ?? 0)} ou {d.config?.juros_max_pct ?? 0}% do saldo (o menor). Extrato de hora em hora.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.resumo.length === 0 ? (
              <p className="text-sm text-ledger-muted">Sem lançamentos automáticos neste período.</p>
            ) : (
              d.resumo.map((r) => (
                <div key={r.acao} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                  <p className="ledger-eyebrow">{ROTULO_ACAO[r.acao]}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-ledger-text">{r.qtd} · {formatBRLFromCents(r.valor_cents)}</p>
                  {r.juros_cents > 0 ? <p className="text-xs text-ledger-muted">juros {formatBRLFromCents(r.juros_cents)}</p> : null}
                </div>
              ))
            )}
          </div>
          <div>
            <p className="ledger-eyebrow mb-1">Fila de exceção ({d.excecoes_abertas})</p>
            <p className="mb-2 text-xs text-ledger-muted">
              Não casou com segurança: resolver na Mesa de conciliação (o "Não, é novo" lança preso à cobrança, sem duplicar).
            </p>
            {excecoes.length === 0 ? <p className="text-sm text-ledger-muted">Nenhuma exceção aberta.</p> : (
              <ul>{excecoes.map((it) => <Linha key={it.id} it={it} onDesfeito={atualizar} />)}</ul>
            )}
          </div>
          <div>
            <p className="ledger-eyebrow mb-2">Lançado sozinho no período ({feitos.length})</p>
            {feitos.length === 0 ? <p className="text-sm text-ledger-muted">Nada lançado neste período.</p> : (
              <ul>{feitos.map((it) => <Linha key={it.id} it={it} onDesfeito={atualizar} />)}</ul>
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

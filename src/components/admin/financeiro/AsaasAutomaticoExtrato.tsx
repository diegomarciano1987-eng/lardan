import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import {
  ROTULO_TIPO_EXTRATO,
  desfazerExtratoAuto,
  relatorioExtratoAuto,
  type ItemExtratoAuto,
  type TipoExtratoAuto,
} from "@/lib/asaas-automatico";

const diaSP = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const PERIODOS = [
  { id: "hoje", rotulo: "Hoje", dias: 0 },
  { id: "ontem", rotulo: "Ontem", dias: 1 },
  { id: "7", rotulo: "Últimos 7 dias", dias: 7 },
] as const;
const TIPOS: TipoExtratoAuto[] = ["identificacao", "tarifa", "notificacoes", "transferencia"];
const quando = (d: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
const MOSTRAR = 15;

function Linha({ it, onDesfeito }: { it: ItemExtratoAuto; onDesfeito: () => void }) {
  const [abrindo, setAbrindo] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const m = useMutation({
    mutationFn: () => desfazerExtratoAuto(it.id, motivo.trim()),
    onSuccess: () => {
      toast.success("Desfeito: a linha do extrato voltou para decisão manual.");
      setAbrindo(false);
      onDesfeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mes = typeof it.detalhe?.["mes"] === "string" ? String(it.detalhe["mes"]) : null;
  const titulo =
    it.tipo === "identificacao"
      ? (it.pessoa ?? "Pessoa da cobrança")
      : it.tipo === "notificacoes" && mes
        ? `Asaas · ${mes.slice(5, 7)}/${mes.slice(0, 4)}`
        : "Asaas - Sistema Pagamento";
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {titulo}
            {it.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {it.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">
            {it.pay ?? (typeof it.detalhe?.["pay"] === "string" ? String(it.detalhe["pay"]) : "")}
            {it.titulo_numero ? ` · título ${it.titulo_numero}` : ""} · {it.motivo}
          </p>
          {it.desfeito_em ? (
            <p className="mt-1 text-xs font-semibold text-ledger-text">Desfeito em {quando(it.desfeito_em)}: {it.desfeito_motivo}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tabular-nums text-ledger-text">
            {it.valor_cents != null ? formatBRLFromCents(it.valor_cents) : "—"}
          </span>
          {!it.desfeito_em ? (
            <button type="button" className="admin-btn h-9" onClick={() => setAbrindo((v) => !v)}>
              <Undo2 aria-hidden className="mr-1 inline size-4" /> Desfazer
            </button>
          ) : (
            <StatusBadge tone="neutral">Desfeito</StatusBadge>
          )}
        </div>
      </div>
      {abrindo ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            aria-label="Motivo para desfazer"
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

function Grupo({ tipo, itens, total, onDesfeito }: { tipo: TipoExtratoAuto; itens: ItemExtratoAuto[]; total: number; onDesfeito: () => void }) {
  const [todos, setTodos] = React.useState(false);
  if (itens.length === 0) return null;
  const vis = todos ? itens : itens.slice(0, MOSTRAR);
  return (
    <div>
      <p className="ledger-eyebrow mb-1">
        {ROTULO_TIPO_EXTRATO[tipo]} ({total > itens.length ? `${itens.length} mais recentes de ${total}` : itens.length})
      </p>
      <ul>{vis.map((it) => <Linha key={it.id} it={it} onDesfeito={onDesfeito} />)}</ul>
      {itens.length > MOSTRAR ? (
        <button type="button" className="admin-btn mt-2 h-9" onClick={() => setTodos((v) => !v)}>
          {todos ? "Mostrar menos" : `Mostrar todos (${itens.length})`}
        </button>
      ) : null}
    </div>
  );
}

/** 0286 — etapa B: títulos da planilha identificados, tarifas, notificações do mês e transferências conferidas. */
export function AsaasAutomaticoExtrato() {
  const [periodo, setPeriodo] = React.useState<(typeof PERIODOS)[number]["id"]>("hoje");
  const qc = useQueryClient();
  const p = PERIODOS.find((x) => x.id === periodo)!;
  const hoje = diaSP();
  const de = diaSP(new Date(Date.now() - p.dias * 86_400_000));
  const ate = p.id === "ontem" ? de : hoje;
  const q = useQuery({ queryKey: ["asaas-automatico-extrato", de, ate], queryFn: () => relatorioExtratoAuto(de, ate), staleTime: 30_000 });
  const d = q.data;
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-automatico-extrato"] });
    void qc.invalidateQueries({ queryKey: ["asaas-saude"] });
  };
  return (
    <Panel
      title="Extrato conferido sozinho"
      action={
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Período do extrato">
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
            <StatusBadge tone={d.ligado ? "success" : "neutral"}>{d.ligado ? "Ligado" : "Desligado"}</StatusBadge>
            <span>
              Títulos da planilha passam para a pessoa da cobrança, tarifa do Pix/boleto vai para 5.1.3, notificações e negativação viram um
              título por mês em 5.1.1 e transferência para o banco já lançada é só conferida.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {d.resumo.length === 0 ? (
              <p className="text-sm text-ledger-muted">Nada conferido neste período.</p>
            ) : (
              d.resumo.map((r) => (
                <div key={r.tipo} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                  <p className="ledger-eyebrow">{ROTULO_TIPO_EXTRATO[r.tipo]}</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-ledger-text">{r.qtd} · {formatBRLFromCents(r.valor_cents)}</p>
                </div>
              ))
            )}
          </div>
          {TIPOS.map((t) => (
            <Grupo
              key={t}
              tipo={t}
              itens={d.itens.filter((i) => i.tipo === t)}
              total={d.resumo.find((r) => r.tipo === t)?.qtd ?? 0}
              onDesfeito={atualizar}
            />
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

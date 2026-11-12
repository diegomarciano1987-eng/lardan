import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { ROTULO_MOTIVO_SALDO, painelSaldo, type TarefaSaldo } from "@/lib/asaas-automatico";
import { decidirSaldo, sincronizarSaldosAgora } from "@/lib/asaas/saldo.functions";

const data = (d?: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d.slice(0, 10)}T12:00:00`)) : "—");
const quando = (d: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(d));
const ESTADO: Record<TarefaSaldo["estado"], { rotulo: string; tom: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  concluida: { rotulo: "Feito no Asaas", tom: "success" },
  excecao: { rotulo: "Decisão sua", tom: "warning" },
  falhou: { rotulo: "Tentando de novo", tom: "danger" },
  pendente: { rotulo: "Na fila", tom: "info" },
  processando: { rotulo: "Enviando", tom: "info" },
  ignorada: { rotulo: "Mantida como está", tom: "neutral" },
};

function Decisao({ t, onFeito }: { t: TarefaSaldo; onFeito: () => void }) {
  const [aberta, setAberta] = React.useState<"" | "substituir" | "ignorar" | "tentar">("");
  const [motivo, setMotivo] = React.useState("");
  const m = useMutation({
    mutationFn: () => decidirSaldo({ data: { id: t.id, decisao: aberta as "substituir" | "ignorar" | "tentar", motivo: motivo.trim() } }),
    onSuccess: () => { toast.success(aberta === "ignorar" ? "Mantida como está." : "Enviado ao Asaas."); setAberta(""); setMotivo(""); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const podeSubstituir = t.estado === "excecao" && ["varias_cobrancas", "cliente_judicial"].includes(t.motivo);
  const podeTentar = t.estado === "falhou" || (t.estado === "excecao" && !["parcela_em_acordo", "varias_cobrancas", "cliente_judicial"].includes(t.motivo));
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {podeSubstituir ? (
          <button type="button" className="inline-flex h-9 items-center rounded-[10px] bg-asaas px-3 text-sm font-semibold text-asaas-foreground" onClick={() => setAberta("substituir")}>
            Trocar por uma cobrança do saldo
          </button>
        ) : null}
        {podeTentar ? <button type="button" className="admin-btn h-9" onClick={() => setAberta("tentar")}>Tentar de novo</button> : null}
        <button type="button" className="admin-btn h-9" onClick={() => setAberta("ignorar")}>Manter como está</button>
      </div>
      {aberta ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className="h-10 min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne"
          />
          <button type="button" className="admin-btn-primary h-10" disabled={motivo.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Gravando…" : "Confirmar"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Linha({ t, onFeito }: { t: TarefaSaldo; onFeito: () => void }) {
  const e = ESTADO[t.estado] ?? ESTADO.pendente;
  const antigas = t.cobrancas.map((c) => `${c.external_id} ${formatBRLFromCents(c.valor_cents)}`).join(" · ");
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {t.pessoa ?? "Sem cadastro"}
            {t.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {t.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">
            título {t.titulo_numero} · {ROTULO_MOTIVO_SALDO[t.motivo] ?? t.motivo} · {quando(t.concluida_em ?? t.created_at)}
          </p>
          <p className="mt-1 text-xs text-ledger-text">
            Cancelada{t.cobrancas.length > 1 ? "s" : ""}: {antigas || "—"}
            {t.nova_external_id ? <> → nova <strong>{t.nova_external_id}</strong> de <strong>{formatBRLFromCents(t.novo_valor_cents ?? 0)}</strong>, vence {data(t.novo_vencimento)}</> : null}
          </p>
          {t.erro ? <p className="mt-1 text-xs text-ledger-muted">{t.erro}</p> : null}
          {t.decisao_motivo ? <p className="mt-1 text-xs text-ledger-muted">Decisão: {t.decisao_motivo}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={e.tom}>{e.rotulo}</StatusBadge>
          <span className="text-sm font-bold tabular-nums text-ledger-text">saldo {formatBRLFromCents(t.saldo_cents)}</span>
          {t.nova_invoice_url ? (
            <a href={t.nova_invoice_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-asaas underline-offset-2 hover:underline">Ver fatura</a>
          ) : null}
        </div>
      </div>
      {t.estado === "excecao" || t.estado === "falhou" ? <Decisao t={t} onFeito={onFeito} /> : null}
    </li>
  );
}

/** 0299 — baixa no Lardan (manual, OFX, outra conta) ou título cancelado → cobrança do Asaas acompanha. */
export function AsaasSaldoEspelho() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["asaas-saldo-espelho"], queryFn: painelSaldo, staleTime: 30_000, refetchInterval: 60_000 });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-saldo-espelho"] });
    void qc.invalidateQueries({ queryKey: ["asaas-pente-fino"] });
  };
  const agora = useMutation({
    mutationFn: () => sincronizarSaldosAgora(),
    onSuccess: (r) => { toast.success(r.processadas ? `${r.processadas} ajuste(s) enviados ao Asaas.` : "Asaas já confere com o Lardan."); atualizar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = q.data;
  const excecoes = (d?.tarefas ?? []).filter((t) => t.estado === "excecao" || t.estado === "falhou");
  const feitas = (d?.tarefas ?? []).filter((t) => !(t.estado === "excecao" || t.estado === "falhou"));
  return (
    <Panel
      title="Baixa no Lardan → cobrança no Asaas"
      action={
        <button type="button" disabled={agora.isPending} onClick={() => agora.mutate()}
          className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-asaas px-3 text-sm font-semibold text-asaas-foreground disabled:opacity-60">
          <RefreshCw aria-hidden className={`size-4 ${agora.isPending ? "animate-spin" : ""}`} /> Conferir agora
        </button>
      }
    >
      {q.isLoading ? <p className="text-sm text-ledger-muted">Carregando…</p> : null}
      {q.error ? <p className="text-sm font-medium text-ledger-text">{(q.error as Error).message}</p> : null}
      {d ? (
        <div className="space-y-5">
          <p className="text-sm text-ledger-text">
            Toda baixa feita aqui (manual, OFX, Pix em outra conta, desconto) ou título cancelado cancela a cobrança antiga no Asaas em até 1 minuto.
            Se sobrar saldo, o Asaas recebe na hora uma cobrança nova com o valor exato e vencimento a partir de hoje. Acordos não são tocados.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
              <p className="ledger-eyebrow">Ajustadas no Asaas</p>
              <p className="mt-1 text-sm tabular-nums text-ledger-text"><strong>{d.resumo.concluidas}</strong> · cobravam {formatBRLFromCents(d.resumo.canceladas_cents)}</p>
            </div>
            <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
              <p className="ledger-eyebrow">Novas pelo saldo</p>
              <p className="mt-1 text-sm tabular-nums text-ledger-text"><strong>{d.resumo.novas}</strong> · {formatBRLFromCents(d.resumo.novas_cents)}</p>
            </div>
            <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
              <p className="ledger-eyebrow">Para decidir</p>
              <p className="mt-1 text-sm tabular-nums text-ledger-text"><strong>{d.resumo.excecoes}</strong>{d.resumo.andamento ? ` · ${d.resumo.andamento} na fila` : ""}</p>
            </div>
          </div>
          <div>
            <p className="ledger-eyebrow mb-2">Para decidir ({excecoes.length})</p>
            {excecoes.length === 0 ? <p className="text-sm text-ledger-muted">Nada esperando decisão.</p> : (
              <ul>{excecoes.map((t) => <Linha key={t.id} t={t} onFeito={atualizar} />)}</ul>
            )}
          </div>
          {feitas.length ? (
            <div>
              <p className="ledger-eyebrow mb-2">Últimos ajustes ({feitas.length})</p>
              <ul>{feitas.map((t) => <Linha key={t.id} t={t} onFeito={atualizar} />)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

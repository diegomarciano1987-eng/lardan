import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { ROTULO_MOTIVO_SALDO, diferencasEspelho, type DiferencaEspelho } from "@/lib/asaas-automatico";
import { espelharParcelaAgora } from "@/lib/asaas/saldo.functions";
import { editarParcelaFin } from "@/lib/financeiro";
import { useCapabilities } from "@/lib/capabilities";

const data = (d?: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d.slice(0, 10)}T12:00:00`)) : "—");

type Acao = "" | "levar" | "trazer";

function Linha({ d, podeMexer, onFeito }: { d: DiferencaEspelho; podeMexer: boolean; onFeito: () => void }) {
  const [aberta, setAberta] = React.useState<Acao>("");
  const [motivo, setMotivo] = React.useState("");
  const m = useMutation({
    mutationFn: async () => {
      if (aberta === "levar") return espelharParcelaAgora({ data: { installmentId: d.installment_id, motivo: motivo.trim() } });
      await editarParcelaFin(d.installment_id, d.asaas_vencimento, d.parcela_valor_cents, motivo.trim());
      return { ok: true, processadas: 0, tarefa: null };
    },
    onSuccess: (r) => {
      if (aberta === "trazer") toast.success("Vencimento do Lardan igualado ao do Asaas. Fica no histórico do título.");
      else if (r.tarefa?.estado === "concluida") toast.success("Asaas atualizado com o vencimento e o valor do Lardan.");
      else if (r.tarefa?.estado === "excecao") toast.error(`Não alterado: ${ROTULO_MOTIVO_SALDO[r.tarefa.motivo] ?? r.tarefa.motivo}. ${r.tarefa.erro ?? ""}`);
      else toast.success("Pedido enviado. O Asaas é atualizado em até 1 minuto.");
      setAberta("");
      setMotivo("");
      onFeito();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const tarefaAberta = d.pedido_aberto || ["pendente", "processando", "falhou"].includes(d.tarefa_estado ?? "");
  return (
    <li className="border-b border-line-soft py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ledger-text">
            {d.pessoa ?? "Sem cadastro"}
            {d.pessoa_codigo ? <span className="ml-1 font-normal text-ledger-muted">· Cód. {d.pessoa_codigo}</span> : null}
          </p>
          <p className="text-xs text-ledger-muted">título {d.titulo_numero} · cobrança {d.external_id}</p>
          <p className="mt-1 text-xs text-ledger-text">
            Lardan: vence <strong className={d.vencimento_diferente ? "text-warning" : ""}>{data(d.lardan_vencimento)}</strong> ·{" "}
            <strong className={d.valor_diferente ? "text-warning" : ""}>{formatBRLFromCents(d.lardan_saldo_cents)}</strong>
            {"  →  "}
            Asaas: vence <strong className={d.vencimento_diferente ? "text-warning" : ""}>{data(d.asaas_vencimento)}</strong> ·{" "}
            <strong className={d.valor_diferente ? "text-warning" : ""}>{formatBRLFromCents(d.asaas_valor_cents)}</strong>
          </p>
          {!d.pode_levar && d.vencimento_diferente ? (
            <p className="mt-1 text-xs text-ledger-muted">O vencimento do Lardan já passou e o Asaas não aceita data passada: ajuste a data no Lardan ou traga a do Asaas.</p>
          ) : null}
          {d.tarefa_estado === "excecao" && d.tarefa_motivo ? (
            <p className="mt-1 text-xs text-ledger-muted">Última tentativa: {ROTULO_MOTIVO_SALDO[d.tarefa_motivo] ?? d.tarefa_motivo}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={tarefaAberta ? "info" : "warning"}>{tarefaAberta ? "Atualizando o Asaas" : "Diferente"}</StatusBadge>
          {d.invoice_url ? (
            <a href={d.invoice_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-asaas underline-offset-2 hover:underline">Ver fatura</a>
          ) : null}
        </div>
      </div>
      {podeMexer && !tarefaAberta ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.pode_levar ? (
            <button type="button" className="inline-flex h-9 items-center rounded-[10px] bg-asaas px-3 text-sm font-semibold text-asaas-foreground" onClick={() => setAberta("levar")}>
              Levar o Lardan ao Asaas
            </button>
          ) : null}
          {d.vencimento_diferente && !d.valor_diferente ? (
            <button type="button" className="admin-btn h-9" onClick={() => setAberta("trazer")}>Trazer a data do Asaas para o Lardan</button>
          ) : null}
        </div>
      ) : null}
      {aberta ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (obrigatório)"
            className="h-10 min-w-[16rem] flex-1 rounded-[10px] border border-line bg-surface px-3 text-sm text-ledger-text outline-none focus:border-champagne"
          />
          <button type="button" className="admin-btn h-10" disabled={m.isPending} onClick={() => setAberta("")}>Voltar</button>
          <button type="button" className="admin-btn-primary h-10" disabled={motivo.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Conferindo no Asaas…" : "Confirmar"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** 0303 — tudo que está diferente agora entre a parcela do Lardan e a cobrança aberta no Asaas. */
export function AsaasEspelhoDiferencas() {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeMexer = caps.includes("finance.receivable.manage");
  const q = useQuery({ queryKey: ["asaas-espelho-diferencas"], queryFn: diferencasEspelho, staleTime: 30_000, refetchInterval: 60_000 });
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["asaas-espelho-diferencas"] });
    void qc.invalidateQueries({ queryKey: ["asaas-saldo-espelho"] });
  };
  const lista = q.data ?? [];
  return (
    <Panel title={`Diferenças Lardan × Asaas agora${q.data ? ` (${lista.length})` : ""}`}>
      <p className="text-sm text-ledger-text">
        Regra: o Asaas cobra exatamente o que está no Lardan. Mudou o vencimento ou o valor de uma parcela aqui, a mesma cobrança do Asaas
        é atualizada em até 1 minuto (o sistema confere lá antes: se já foi paga, nada muda). O que ainda estiver diferente aparece nesta lista.
      </p>
      {q.isLoading ? <p className="mt-3 text-sm text-ledger-muted">Carregando…</p> : null}
      {q.error ? <p className="mt-3 text-sm font-medium text-ledger-text">{(q.error as Error).message}</p> : null}
      {q.data && lista.length === 0 ? <p className="mt-3 text-sm text-ledger-muted">Nenhuma diferença: Asaas igual ao Lardan.</p> : null}
      {lista.length ? <ul className="mt-3">{lista.map((d) => <Linha key={d.charge_id} d={d} podeMexer={podeMexer} onFeito={atualizar} />)}</ul> : null}
    </Panel>
  );
}

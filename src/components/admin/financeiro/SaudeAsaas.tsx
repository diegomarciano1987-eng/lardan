import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Panel, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { saudeAsaas, processarFilaAsaas } from "@/lib/asaas/extrato.functions";

const quando = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(d)) : "Nunca";

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 text-sm font-semibold text-ledger-text">{valor}</p>
    </div>
  );
}

/** Verificação somente leitura da conexão Asaas. */
export function SaudeAsaas() {
  const fn = useServerFn(saudeAsaas);
  const q = useQuery({ queryKey: ["asaas-saude"], queryFn: () => fn(), staleTime: 60_000 });
  const d = q.data;
  const proc = useServerFn(processarFilaAsaas);
  const m = useMutation({ mutationFn: () => proc(), onSuccess: () => void q.refetch() });
  return (
    <Panel title="Saúde da conexão Asaas">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {q.isLoading ? (
          <StatusBadge tone="neutral">Verificando…</StatusBadge>
        ) : d?.ok ? (
          <StatusBadge tone="success">
            Conectado — {d.ambiente === "producao" ? "Produção" : "Sandbox"}
          </StatusBadge>
        ) : (
          <StatusBadge tone="danger">Falha na conexão</StatusBadge>
        )}
        {d?.conta ? <span className="text-sm font-medium text-ledger-text">{d.conta}</span> : null}
        <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text hover:border-champagne" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw aria-hidden className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
          Verificar agora
        </button>
      </div>
      {d && d.avisosNaFila > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-line-soft bg-cream-2 p-3 text-sm text-ledger-text">
          <span>Avisos do Asaas chegaram antes da cobrança ser trazida. Processar atualiza só a situação das cobranças — nenhuma baixa é feita.</span>
          <button type="button" className="admin-btn" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? "Processando…" : "Processar fila"}
          </button>
          {m.data ? <span className="font-medium">{m.data.processados} processados · {m.data.semCobranca} sem cobrança · {m.data.falhas} com erro</span> : null}
          {m.error ? <span className="font-medium">{(m.error as Error).message}</span> : null}
        </div>
      ) : null}
      {d?.erro ? (
        <p className="mb-4 rounded-[10px] border border-line-soft bg-cream-2 p-3 text-sm font-medium text-ledger-text">
          {d.erro}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Item rotulo="Saldo na conta Asaas" valor={d?.saldoCents != null ? formatBRLFromCents(d.saldoCents) : "—"} />
        <Item rotulo="Última verificação" valor={quando(d?.verificadoEm ?? null)} />
        <Item
          rotulo="Último aviso (webhook)"
          valor={quando(d?.ultimoWebhook ?? null)}
        />
        <Item rotulo="Avisos aguardando processamento" valor={d ? `${d.avisosNaFila} na fila (não são falhas)` : "—"} />
        <Item
          rotulo="Última importação de cobranças"
          valor={`${quando(d?.ultimaImportacao ?? null)}${d?.situacaoImportacao ? ` · ${d.situacaoImportacao}` : ""}`}
        />
        <Item rotulo="Última busca do extrato" valor={quando(d?.ultimoExtrato ?? null)} />
      </div>
    </Panel>
  );
}

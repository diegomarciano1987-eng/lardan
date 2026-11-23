import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Bot, RefreshCw, Undo2, UserRound } from "lucide-react";
import { Panel, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { PedirDadosDialog } from "@/components/admin/financeiro/PedirDadosDialog";
import { useCapabilities } from "@/lib/capabilities";
import {
  desfazerTransferenciaDoExtrato, painelTransferencias, parearTransferenciasAgora, type TransferenciaFeita,
} from "@/lib/transferencias-extrato";

const dataBR = (d: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(d.length === 10 ? `${d}T12:00:00` : d)) : "—");

/** 0369 — Transferências entre contas da empresa: o que foi pareado (Mesa ou sozinho) e o que espera o extrato da outra conta. */
export function TransferenciasExtrato({ onMudou }: { onMudou?: () => void }) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const podeAgir = caps.includes("finance.reconcile") && caps.includes("finance.statement.flag") && caps.includes("finance.bank.manage");
  const q = useQuery({ queryKey: ["fin-transferencias-extrato"], queryFn: () => painelTransferencias(60), staleTime: 30_000 });
  const [desfazendo, setDesfazendo] = React.useState<TransferenciaFeita | null>(null);
  const [verTodas, setVerTodas] = React.useState(false);

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["fin-transferencias-extrato"] });
    onMudou?.();
  };
  const procurar = useMutation({
    mutationFn: parearTransferenciasAgora,
    onSuccess: (r) => {
      const feitas = r.novas + r.existentes;
      toast.success(feitas > 0
        ? `${feitas} transferência(s) entre contas conferida(s) sozinha(s).`
        : r.ambiguas > 0
          ? `Nenhuma conferida sozinha: ${r.ambiguas} caso(s) com mais de uma possibilidade ficam para a Mesa.`
          : "Nenhuma transferência nova para parear agora.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const desfazer = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => desfazerTransferenciaDoExtrato(id, motivo),
    onSuccess: () => { toast.success("Transferência desfeita: linhas voltaram para pendente e a transferência foi estornada."); setDesfazendo(null); atualizar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const feitas = q.data?.feitas ?? [];
  const aguardando = q.data?.aguardando ?? [];
  const lista = verTodas ? feitas : feitas.slice(0, 6);

  return (
    <Panel
      title="Transferências entre contas da empresa"
      action={podeAgir ? (
        <button type="button" className="admin-btn" disabled={procurar.isPending} onClick={() => procurar.mutate()}>
          <RefreshCw aria-hidden className={`mr-1 inline size-4 ${procurar.isPending ? "animate-spin" : ""}`} />
          {procurar.isPending ? "Procurando…" : "Procurar agora"}
        </button>
      ) : undefined}
    >
      <p className="text-sm text-ledger-muted">
        Saída e entrada do mesmo valor entre contas da empresa (até 3 dias) são conferidas sozinhas a cada 10 minutos, quando os dois
        extratos citam o CNPJ ou a razão social da empresa e só existe um par possível. Não vira conta a pagar nem receita.
      </p>
      {q.isLoading && <Skeleton className="mt-4 h-24 w-full" />}
      {q.error && <p className="mt-4 text-sm text-destructive">{(q.error as Error).message}</p>}

      {aguardando.length > 0 && (
        <div className="mt-4 rounded-[12px] border border-warning/50 bg-cream-2 p-4">
          <p className="text-sm font-semibold text-ledger-text">
            {aguardando.length} movimento(s) da empresa ainda sem a outra ponta
          </p>
          <p className="text-xs text-ledger-muted">Importe o extrato da outra conta ou lance pela Mesa em “Transferência entre contas”.</p>
          <ul className="mt-3 space-y-1.5">
            {aguardando.slice(0, 8).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular-nums text-ledger-muted">{dataBR(l.data)}</span>
                <span className="font-semibold text-ledger-text">{l.conta}</span>
                <span className="min-w-0 flex-1 truncate text-ledger-muted">{l.historico}</span>
                <span className={`font-semibold tabular-nums ${l.kind === "saida" ? "text-destructive" : "text-ledger-text"}`}>
                  {l.kind === "saida" ? "− " : "+ "}{formatBRLFromCents(l.valor_cents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!q.isLoading && feitas.length === 0 && aguardando.length === 0 && (
        <p className="mt-4 rounded-[12px] bg-cream-2 p-4 text-center text-sm text-ledger-muted">Nenhuma transferência entre contas pelo extrato nos últimos 60 dias.</p>
      )}

      {feitas.length > 0 && (
        <ul className="mt-4 divide-y divide-line-soft">
          {lista.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <ArrowLeftRight aria-hidden className="size-4 shrink-0 text-bronze" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ledger-text">{t.conta_origem ?? "?"} → {t.conta_destino ?? "?"}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ledger-muted">
                  <span>{dataBR(t.data)}</span>
                  <span className="inline-flex items-center gap-1">
                    {t.origem === "automatico" ? <Bot aria-hidden className="size-3" /> : <UserRound aria-hidden className="size-3" />}
                    {t.origem === "automatico" ? "conferida sozinha" : `na Mesa${t.quem ? ` por ${t.quem}` : ""}`}
                  </span>
                  {t.modo === "existente" && <span>· já estava lançada</span>}
                  {!(t.historico_saida && t.historico_entrada) && !t.desfeito_em && <span>· aguarda a linha da outra conta</span>}
                </p>
                {t.desfeito_em && <p className="text-xs text-ledger-muted">Desfeita em {dataBR(t.desfeito_em)}: {t.desfeito_motivo}</p>}
              </div>
              <span className="text-base font-bold tabular-nums text-ledger-text">{formatBRLFromCents(t.valor_cents)}</span>
              {t.desfeito_em ? (
                <StatusBadge tone="neutral">Desfeita</StatusBadge>
              ) : podeAgir ? (
                <button type="button" className="admin-btn" onClick={() => setDesfazendo(t)}>
                  <Undo2 aria-hidden className="mr-1 inline size-4" /> Desfazer
                </button>
              ) : (
                <StatusBadge tone="success">Conferida</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      )}
      {feitas.length > 6 && (
        <button type="button" className="mt-2 text-sm font-semibold text-bronze underline-offset-4 hover:underline" onClick={() => setVerTodas((v) => !v)}>
          {verTodas ? "Ver menos" : `Ver todas (${feitas.length})`}
        </button>
      )}

      <PedirDadosDialog
        open={!!desfazendo}
        titulo="Desfazer transferência entre contas"
        descricao="As linhas do extrato voltam para pendente e a transferência é estornada (nada é apagado). A rotina não refaz este par sozinha."
        campos={[{ nome: "motivo", rotulo: "Motivo", tipo: "area", obrigatorio: true }]}
        confirmar="Desfazer"
        onOpenChange={(v) => !v && setDesfazendo(null)}
        onConfirmar={(vals) => desfazendo && desfazer.mutate({ id: desfazendo.id, motivo: vals["motivo"] ?? "" })}
      />
    </Panel>
  );
}

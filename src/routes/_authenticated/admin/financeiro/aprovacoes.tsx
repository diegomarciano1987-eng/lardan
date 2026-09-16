import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { TituloSheet } from "@/components/admin/financeiro/TituloSheet";
import { aprovarTitulo, listTitulosPendentes, recusarTitulo } from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro/aprovacoes")({
  component: Aprovacoes,
});

const dataBR = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "—";

function Aprovacoes() {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState<string | null>(null);
  const [recusando, setRecusando] = React.useState<string | null>(null);
  const [motivo, setMotivo] = React.useState("");

  const q = useQuery({ queryKey: ["fin-pending"], queryFn: listTitulosPendentes });

  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ["fin-pending"] });
    void qc.invalidateQueries({ queryKey: ["fin-titles"] });
    void qc.invalidateQueries({ queryKey: ["fin-overview"] });
  };

  const aprovar = useMutation({
    mutationFn: (id: string) => aprovarTitulo(id),
    onSuccess: () => {
      toast.success("Título aprovado.");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recusar = useMutation({
    mutationFn: (v: { id: string; motivo: string }) => recusarTitulo(v.id, v.motivo),
    onSuccess: () => {
      toast.success("Título recusado e devolvido para rascunho.");
      setRecusando(null);
      setMotivo("");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AreaFinanceiraGuard capacidade="finance.dashboard.view">
      <Panel title="Títulos aguardando decisão">
        {q.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {q.error ? <ErrorState message="Não foi possível carregar a fila de aprovações." /> : null}
        {q.data && q.data.rows.length === 0 ? (
          <EmptyState
            title="Nada aguardando aprovação"
            description="Quando um título for submetido, ele aparece aqui para decisão."
          />
        ) : null}

        {q.data && q.data.rows.length > 0 ? (
          <div className="space-y-3">
            {!q.data.pode_decidir ? (
              <p className="text-sm font-medium text-ledger-muted">
                Você pode acompanhar a fila, mas não tem permissão para aprovar ou recusar.
              </p>
            ) : null}
            {q.data.rows.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setAberto(t.id)}
                >
                  <p className="truncate font-semibold text-ledger-text">{t.descricao}</p>
                  <p className="truncate text-xs text-ledger-muted">
                    {t.contraparte} · {t.direction === "payable" ? "a pagar" : "a receber"} ·
                    emissão {dataBR(t.emissao)}
                  </p>
                </button>
                <p className="font-display text-lg font-bold tabular-nums text-ledger-text">
                  {formatBRLFromCents(t.valor_cents)}
                </p>
                {q.data.pode_decidir ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="admin-btn-primary"
                      onClick={() => aprovar.mutate(t.id)}
                      disabled={aprovar.isPending}
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      className="admin-btn"
                      onClick={() => {
                        setRecusando(t.id);
                        setMotivo("");
                      }}
                    >
                      Recusar
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Dialog open={!!recusando} onOpenChange={(v) => !v && setRecusando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recusar título</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium text-ledger-muted">
            O motivo fica registrado no histórico e o título volta para rascunho.
          </p>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            placeholder="Motivo da recusa"
            className="w-full rounded-[10px] border border-line bg-surface p-3 text-sm text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
          />
          <DialogFooter>
            <button
              type="button"
              className="admin-btn-primary"
              disabled={recusar.isPending}
              onClick={() => {
                if (!motivo.trim()) {
                  toast.error("Informe o motivo da recusa.");
                  return;
                }
                recusar.mutate({ id: recusando as string, motivo: motivo.trim() });
              }}
            >
              Confirmar recusa
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TituloSheet id={aberto} onOpenChange={(v) => !v && setAberto(null)} />
    </AreaFinanceiraGuard>
  );
}

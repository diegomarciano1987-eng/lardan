import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime, formatInt } from "@/components/admin/ui";
import {
  RESERVATION_LABEL,
  confirmReservation,
  fetchReservation,
  releaseReservation,
  type ReservationRow,
} from "@/lib/stock";

type Acao = "confirmar" | "liberar" | "cancelar";

const TITULO: Record<Acao, string> = {
  confirmar: "Confirmar saída da reserva",
  liberar: "Liberar reserva",
  cancelar: "Cancelar reserva",
};

const TEXTO: Record<Acao, string> = {
  confirmar:
    "A reserva vira uma saída física única. Mesmo se o botão for clicado duas vezes, só uma saída é gravada.",
  liberar:
    "As unidades voltam a ficar disponíveis. O saldo físico não muda e a reserva continua no histórico.",
  cancelar:
    "As unidades voltam a ficar disponíveis. O motivo do cancelamento fica registrado para sempre.",
};

/** Confirmação, liberação e cancelamento de uma reserva. */
export function ReservationActionDialog({
  reserva,
  acao,
  onClose,
}: {
  reserva: ReservationRow | null;
  acao: Acao | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = React.useState("");
  const [referencia, setReferencia] = React.useState("");

  React.useEffect(() => {
    setMotivo("");
    setReferencia("");
  }, [reserva?.id, acao]);

  const executar = useMutation({
    mutationFn: async () => {
      if (!reserva || !acao) return null;
      if (acao === "cancelar" && !motivo.trim())
        throw new Error("Informe o motivo do cancelamento.");
      if (acao === "confirmar")
        return confirmReservation(reserva.id, referencia ? { reference: referencia } : undefined);
      return releaseReservation(reserva.id, acao === "cancelar", motivo || undefined);
    },
    onSuccess: () => {
      toast.success(
        acao === "confirmar"
          ? "Saída confirmada a partir da reserva."
          : acao === "cancelar"
            ? "Reserva cancelada."
            : "Reserva liberada.",
      );
      qc.invalidateQueries({ queryKey: ["stock"] });
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir a operação."),
  });

  const aberto = Boolean(reserva && acao);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">{acao ? TITULO[acao] : ""}</DialogTitle>
          <DialogDescription>{acao ? TEXTO[acao] : ""}</DialogDescription>
        </DialogHeader>

        {reserva && (
          <dl className="divide-y divide-line rounded-[10px] border border-line">
            {[
              ["Protocolo", reserva.protocolo],
              ["Peça", `${reserva.produto ?? "—"} · ${reserva.variante ?? "—"}`],
              ["Local", reserva.local ?? "—"],
              ["Quantidade", formatInt(reserva.quantidade)],
              ["Validade", formatDateTime(reserva.validade)],
            ].map(([r, v]) => (
              <div key={r} className="flex justify-between gap-6 px-4 py-2.5 text-sm">
                <dt className="font-semibold text-ledger-muted">{r}</dt>
                <dd className="text-right font-medium text-ledger-text">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {acao === "confirmar" && (
          <label className="block space-y-1.5">
            <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
              Referência (opcional)
            </span>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Pedido, nota, atendimento"
              className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
            />
          </label>
        )}

        {acao === "cancelar" && (
          <label className="block space-y-1.5">
            <span className="text-[0.72rem] font-semibold tracking-[0.12em] text-bronze uppercase">
              Motivo do cancelamento
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Explique por que esta reserva foi cancelada"
              className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm font-medium text-ledger-text shadow-sm outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
            />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="admin-btn">
            Voltar
          </button>
          <button
            type="button"
            disabled={executar.isPending}
            onClick={() => executar.mutate()}
            className="admin-btn-primary"
          >
            {executar.isPending ? "Gravando…" : acao ? TITULO[acao] : ""}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Histórico completo de uma reserva: cada passo com autor e data. */
export function ReservationHistorySheet({
  reservaId,
  onClose,
}: {
  reservaId: string | null;
  onClose: () => void;
}) {
  const detalhe = useQuery({
    queryKey: ["stock", "reserva", reservaId],
    queryFn: () => fetchReservation(reservaId as string),
    enabled: Boolean(reservaId),
  });
  const d = detalhe.data;

  return (
    <Sheet open={Boolean(reservaId)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="admin-scope w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-xl">{d?.protocolo ?? "Reserva"}</SheetTitle>
          <SheetDescription>
            {d ? `${d.produto ?? "—"} · ${d.variante ?? "—"}` : "Carregando…"}
          </SheetDescription>
        </SheetHeader>

        {detalhe.error ? (
          <p className="mt-6 text-sm font-medium text-ledger-muted">
            Não foi possível abrir esta reserva.
          </p>
        ) : !d ? (
          <p className="mt-6 text-sm font-medium text-ledger-muted">Carregando…</p>
        ) : (
          <div className="mt-6 space-y-6">
            <div>
              {[
                ["Situação", RESERVATION_LABEL[d.situacao] ?? d.situacao],
                ["Quantidade", formatInt(d.quantidade)],
                ["Local", d.local ?? "—"],
                ["SKU", d.sku ?? "—"],
                ["Origem", d.origem],
                ["Referência", d.referencia ?? "—"],
                ["Reservada para", d.pessoa ?? "—"],
                ["Criada em", formatDateTime(d.criada_em)],
                ["Criada por", d.autor ?? "—"],
                ["Validade", formatDateTime(d.validade)],
                ["Confirmada em", d.confirmada_em ? formatDateTime(d.confirmada_em) : "—"],
                ["Liberada em", d.liberada_em ? formatDateTime(d.liberada_em) : "—"],
                ["Motivo do cancelamento", d.motivo_cancelamento ?? "—"],
                ["Observação", d.observacao ?? "—"],
              ].map(([r, v]) => (
                <div
                  key={r}
                  className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2"
                >
                  <span className="text-[0.72rem] font-semibold tracking-[0.1em] text-ledger-muted uppercase">
                    {r}
                  </span>
                  <span className="text-right text-sm font-medium text-ledger-text">{v}</span>
                </div>
              ))}
            </div>

            <div>
              <p className="ledger-eyebrow mb-2">Histórico</p>
              {(d.historico ?? []).length === 0 ? (
                <p className="text-sm font-medium text-ledger-muted">
                  Sem registros de auditoria para esta reserva.
                </p>
              ) : (
                <ul className="space-y-2">
                  {d.historico.map((h, i) => (
                    <li
                      key={`${h.acao}-${i}`}
                      className="rounded-[10px] border border-line px-4 py-2.5 text-sm"
                    >
                      <p className="font-semibold text-ledger-text">{h.acao}</p>
                      <p className="text-xs text-ledger-muted">
                        {formatDateTime(h.em)}
                        {h.autor ? ` · ${h.autor}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

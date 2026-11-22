import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRLFromCents } from "@/components/admin/ui";
import { liquidarDivida, reconferirTituloAsaas, type CobrancaReconferida } from "@/lib/asaas/divida.functions";

const MOTIVOS = ["Erro de lançamento", "Dívida perdoada", "Negociado fora do sistema", "Baixa já feita no Asaas"];

/**
 * 22/11: liquidar (apagar) a dívida inteira ou uma parcela, com motivo obrigatório.
 * Fica registrado quem fez; cobrança aberta no Asaas é cancelada na hora.
 */
export function LiquidarDividaDialog({
  alvo,
  onOpenChange,
  onFeito,
}: {
  alvo: { titleId: string; installmentId?: string | null; descricao: string; saldoCents: number } | null;
  onOpenChange: (v: boolean) => void;
  onFeito?: () => void;
}) {
  const qc = useQueryClient();
  const liquidar = useServerFn(liquidarDivida);
  const [motivo, setMotivo] = React.useState("");
  React.useEffect(() => { if (alvo) setMotivo(""); }, [alvo]);

  const m = useMutation({
    mutationFn: async () => {
      if (!alvo) throw new Error("Nada escolhido.");
      if (motivo.trim().length < 5) throw new Error("Escreva o motivo (mínimo 5 letras).");
      return liquidar({ data: { titleId: alvo.titleId, installmentId: alvo.installmentId ?? null, motivo: motivo.trim() } });
    },
    onSuccess: (r) => {
      const asaasOk = r.asaas.filter((a) => a.resultado === "cancelada" || a.resultado === "ja_excluida").length;
      const pagas = r.asaas.filter((a) => a.resultado === "paga_no_asaas").length;
      const falhas = r.asaas.filter((a) => a.resultado === "falhou");
      const titulo = r.modo === "ja_liquidada" ? "Esta dívida já estava liquidada." : `Dívida liquidada: ${formatBRLFromCents(r.valor_cents)}.`;
      const partes: string[] = [];
      if (asaasOk) partes.push(`${asaasOk} cobrança(s) cancelada(s) no Asaas agora.`);
      if (pagas) partes.push(`${pagas} cobrança(s) já estava(m) paga(s) no Asaas: nada foi cancelado lá. Confira a baixa.`);
      if (falhas.length) partes.push(`Não consegui cancelar ${falhas.length} no Asaas agora; o sistema tenta de novo em até 1 minuto.`);
      if (!r.asaas.length && r.modo !== "ja_liquidada") partes.push("Não havia cobrança aberta no Asaas.");
      (falhas.length || pagas ? toast.warning : toast.success)(titulo, { description: partes.join(" ") || undefined });
      for (const k of [["fin-title"], ["fin-titles"], ["fin-pagar-receber"], ["fin-overview"], ["cob"], ["asaas-espelho-diferencas"]]) {
        void qc.invalidateQueries({ queryKey: k });
      }
      onOpenChange(false);
      onFeito?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!alvo} onOpenChange={(v) => !m.isPending && onOpenChange(v)}>
      <DialogContent className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{alvo?.installmentId ? "Liquidar parcela" : "Liquidar dívida"}</DialogTitle>
          <DialogDescription>
            {alvo ? `${alvo.descricao} · saldo ${formatBRLFromCents(alvo.saldoCents)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ul className="space-y-1 rounded-[10px] border border-line-soft bg-cream-2 p-3 text-xs text-ledger-muted">
            <li>A dívida sai da cobrança e do saldo em aberto. O que já foi pago continua registrado.</li>
            <li>Cobrança aberta no Asaas é cancelada na hora, e a cliente não recebe mais aquele link.</li>
            <li>Fica registrado quem fez, quando e o motivo.</li>
            <li className="font-semibold text-ledger-text">Se a cliente pagou, use "Registrar recebimento": liquidar não lança dinheiro em conta.</li>
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS.map((x) => (
              <button key={x} type="button" onClick={() => setMotivo(x)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${motivo === x ? "border-primary bg-primary/10 text-primary" : "border-line text-ledger-muted hover:border-primary/50"}`}>
                {x}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ledger-muted">Motivo (obrigatório)</span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={300}
              aria-label="Motivo da liquidação"
              className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-ledger-text outline-none focus:border-champagne focus:ring-2 focus:ring-champagne/25"
              placeholder="Explique por que esta dívida está sendo liquidada" />
          </label>
        </div>
        <DialogFooter>
          <button type="button" className="admin-btn" onClick={() => onOpenChange(false)} disabled={m.isPending}>Voltar</button>
          <button type="button" className="admin-btn-primary" onClick={() => m.mutate()} disabled={m.isPending || motivo.trim().length < 5}>
            {m.isPending ? "Liquidando…" : alvo?.installmentId ? "Liquidar parcela" : "Liquidar dívida"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SIT: Record<string, string> = {
  PENDING: "Aguardando pagamento", OVERDUE: "Vencida", RECEIVED: "Paga", CONFIRMED: "Paga (cartão, crédito a cair)",
  RECEIVED_IN_CASH: "Marcada como recebida em dinheiro", DELETED: "Excluída no Asaas", DUNNING_REQUESTED: "Em negativação",
  REFUNDED: "Estornada",
};
const dataBR = (d: string | null) => (d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "");

function explicar(c: CobrancaReconferida) {
  if (c.agora === "PENDING" || c.agora === "OVERDUE" || c.agora === "DUNNING_REQUESTED") return "Igual no Lardan: continua em aberto.";
  if (c.agora === "RECEIVED" || c.agora === "CONFIRMED") {
    if (c.baixa === "lancada") return `Paga no Asaas${c.pagamento ? ` em ${dataBR(c.pagamento)}` : ""}: baixa lançada no Lardan agora.`;
    if (c.baixa === "ja_lancada") return "Paga no Asaas e já baixada no Lardan.";
    return `Paga no Asaas, mas a baixa não entrou sozinha${c.motivo ? ` (${c.motivo.replace(/_/g, " ")})` : ""}. Lance em "Registrar recebimento".`;
  }
  if (c.agora === "RECEIVED_IN_CASH") return `Marcada como recebida em dinheiro no Asaas${c.pagamento ? ` em ${dataBR(c.pagamento)}` : ""}. Lance a baixa em "Registrar recebimento", na conta ou caixa onde o dinheiro entrou.`;
  if (c.agora === "DELETED") return 'Excluída no Asaas. Se a dívida não existe mais, use "Liquidar dívida".';
  return "Situação conferida.";
}

/** 22/11: relê no Asaas, na hora, as cobranças deste título. */
export function ReconferirAsaas({ titleId }: { titleId: string }) {
  const qc = useQueryClient();
  const reconferir = useServerFn(reconferirTituloAsaas);
  const m = useMutation({
    mutationFn: () => reconferir({ data: { titleId } }),
    onSuccess: (r) => {
      if (r.cobrancas.some((c) => c.baixa === "lancada")) toast.success("Baixa lançada a partir do Asaas.");
      void qc.invalidateQueries({ queryKey: ["fin-title", titleId] });
      void qc.invalidateQueries({ queryKey: ["cob"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="rounded-[12px] border border-asaas/40 bg-asaas/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ledger-text">Asaas × Lardan</p>
        <button type="button" className="admin-btn min-h-9 border-asaas/60 px-3 text-xs text-asaas" disabled={m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? "Conferindo no Asaas…" : "Reconferir no Asaas agora"}
        </button>
      </div>
      {m.data ? (
        m.data.cobrancas.length === 0 ? (
          <p className="mt-2 text-xs text-ledger-muted">Nenhuma cobrança do Asaas ligada a este título.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {m.data.cobrancas.map((c) => (
              <li key={c.external_id} className="text-xs text-ledger-muted">
                <span className="font-semibold text-ledger-text">{formatBRLFromCents(c.valor_cents)} · {SIT[c.agora] ?? c.agora}</span>
                {" — "}{explicar(c)}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

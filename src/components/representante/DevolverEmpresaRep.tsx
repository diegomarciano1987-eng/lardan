/**
 * 0280 — no app do representante: a consultora não ficou com a maleta e ele também não vai deixar
 * para outra pessoa → pede a devolução para a empresa. Lá dentro a montagem confirma a chegada e
 * as peças voltam ao estoque.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cancelarDevolucao, devolucoesAbertas, pedirDevolucao } from "@/lib/maleta-devolucao";

export function useDevolucoesRep(rep: string) {
  return useQuery({ queryKey: ["rep", rep, "devolucoes"], queryFn: () => devolucoesAbertas(rep) });
}

export function DevolverEmpresaRep({ rep, cycleId, maleta, pedida }: { rep: string; cycleId: string; maleta: string; pedida?: { id: string } | null }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const fim = () => {
    setAberto(false); setMotivo("");
    void qc.invalidateQueries({ queryKey: ["rep", rep] });
  };
  const pedir = useMutation({
    mutationFn: () => pedirDevolucao(cycleId, motivo),
    onSuccess: () => { toast.success(`Devolução da maleta ${maleta} registrada. Leve a maleta para a empresa; lá eles confirmam a chegada.`); fim(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const desfazer = useMutation({
    mutationFn: () => cancelarDevolucao(pedida!.id, "Representante desfez o pedido"),
    onSuccess: () => { toast.success("Pedido de devolução desfeito."); fim(); },
    onError: (e) => toast.error((e as Error).message),
  });

  if (pedida) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
        <span>Devolução para a empresa pedida. Aguardando a empresa confirmar a chegada.</span>
        <button className="h-9 rounded-lg border border-border px-3 text-sm" disabled={desfazer.isPending}
          onClick={() => { if (window.confirm("Desfazer o pedido de devolução?")) desfazer.mutate(); }}>Desfazer</button>
      </div>
    );
  }
  if (!aberto) {
    return (
      <button className="h-10 w-full rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground" onClick={() => setAberto(true)}>
        Devolver a maleta para a empresa
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 p-3">
      <p className="text-sm font-medium">Devolver a maleta {maleta} para a empresa</p>
      <p className="text-xs text-muted-foreground">Use quando a consultora não ficou com a maleta e você não vai deixar para outra pessoa. A entrega para ela é cancelada. Quando a maleta chegar, a empresa confirma e as peças voltam ao estoque.</p>
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo (ex.: não quis ficar com a maleta no acerto)"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button className="h-10 rounded-lg border border-border px-4 text-sm" onClick={() => setAberto(false)}>Voltar</button>
        <button className="h-10 flex-1 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          disabled={motivo.trim().length < 5 || pedir.isPending} onClick={() => pedir.mutate()}>
          {pedir.isPending ? "Registrando…" : "Confirmar devolução"}
        </button>
      </div>
    </div>
  );
}

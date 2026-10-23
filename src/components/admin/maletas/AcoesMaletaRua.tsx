/**
 * Maleta na rua (0130): pular o acerto (vencimento vai para o próximo acerto da praça)
 * e dar baixa como perdida (estoque sai como perda, sem nota fiscal, vira fiado da consultora).
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, PackageX } from "lucide-react";
import { Panel } from "@/components/admin/ui";
import { baixarMaletaPerdida, brl, dataBr, mensagem, pularAcertoLardan } from "@/lib/maletas-perdidas";

export function AcoesMaletaRua({ cycleId, status, temConsultora }: { cycleId: string; status: string; temConsultora: boolean }) {
  const qc = useQueryClient();
  const [modo, setModo] = React.useState<"" | "pular" | "perdida">("");
  const [motivo, setMotivo] = React.useState("");
  const [data, setData] = React.useState("");
  const podePular = !["encerrada", "cancelada"].includes(status);
  const podePerder = temConsultora && ["recebida", "operacao", "acerto"].includes(status);
  const fim = () => {
    setModo("");
    setMotivo("");
    setData("");
    void qc.invalidateQueries({ queryKey: ["maletas"] });
  };

  const pular = useMutation({
    mutationFn: () => pularAcertoLardan(cycleId, motivo, data || undefined),
    onSuccess: (r) => {
      toast.success(`Acerto adiado de ${dataBr(r.de)} para ${dataBr(r.para)}.`);
      fim();
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  const perder = useMutation({
    mutationFn: () => baixarMaletaPerdida(cycleId, motivo, data || undefined),
    onSuccess: (r) => {
      toast.success(r.repetida ? "Esta maleta já tinha baixa como perdida." : `Baixa feita: ${r.pecas} peças, fiado de ${brl(r.valor_cents)} para a consultora.`);
      fim();
    },
    onError: (e) => toast.error(mensagem(e)),
  });

  if (!podePular && !podePerder) return null;
  return (
    <Panel title="Maleta na rua">
      <div className="space-y-3">
        {modo === "" && (
          <>
            {podePular && (
              <button type="button" className="admin-btn w-full" onClick={() => setModo("pular")}>
                <CalendarClock aria-hidden className="size-4" /> Pular acerto
              </button>
            )}
            {podePerder && (
              <button type="button" className="admin-btn w-full" onClick={() => setModo("perdida")}>
                <PackageX aria-hidden className="size-4" /> Dar baixa como perdida
              </button>
            )}
          </>
        )}
        {modo !== "" && (
          <div className="space-y-3">
            <p className="text-sm text-ledger-muted">
              {modo === "pular"
                ? "O vencimento vai para o acerto da próxima remessa desta praça. Se não houver, informe a data."
                : "As peças que não voltaram saem do estoque como perda, sem nota fiscal, e viram fiado da consultora pelo valor de varejo. A maleta é encerrada."}
            </p>
            <label className="block text-sm">
              <span className="ledger-eyebrow">Motivo</span>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
                className="mt-1 w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="ledger-eyebrow">{modo === "pular" ? "Nova data (opcional)" : "Data da perda (opcional)"}</span>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)}
                className="mt-1 w-full rounded-md border border-line-soft bg-paper px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2">
              <button type="button" className="admin-btn" onClick={() => setModo("")}>Voltar</button>
              <button type="button" className="admin-btn admin-btn-primary flex-1"
                disabled={!motivo.trim() || pular.isPending || perder.isPending}
                onClick={() => (modo === "pular" ? pular.mutate() : perder.mutate())}>
                {modo === "pular" ? "Adiar acerto" : "Confirmar baixa como perdida"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

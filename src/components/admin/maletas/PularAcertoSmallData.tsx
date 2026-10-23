/** Pular acerto de uma maleta do SmallData (0130): o vencimento vai para o próximo acerto da praça. */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataBr, mensagem, pularAcertoSmallData } from "@/lib/maletas-perdidas";

export function PularAcertoSmallData({ remessa, codcli }: { remessa: number; codcli: number }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [data, setData] = React.useState("");
  const m = useMutation({
    mutationFn: () => pularAcertoSmallData(remessa, codcli, motivo, data || undefined),
    onSuccess: (r) => {
      toast.success(`Acerto adiado de ${dataBr(r.de)} para ${dataBr(r.para)}.`);
      setAberto(false);
      setMotivo("");
      setData("");
      void qc.invalidateQueries({ queryKey: ["maletas"] });
    },
    onError: (e) => toast.error(mensagem(e)),
  });
  if (!aberto) {
    return (
      <button type="button" className="admin-btn whitespace-nowrap text-xs" onClick={() => setAberto(true)}>
        Pular acerto
      </button>
    );
  }
  return (
    <div className="grid min-w-56 gap-1.5">
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo"
        className="rounded-md border border-line-soft bg-paper px-2 py-1 text-xs" />
      <input type="date" value={data} onChange={(e) => setData(e.target.value)} title="Vazio = próximo acerto da praça"
        className="rounded-md border border-line-soft bg-paper px-2 py-1 text-xs" />
      <div className="flex gap-1.5">
        <button type="button" className="admin-btn text-xs" onClick={() => setAberto(false)}>Voltar</button>
        <button type="button" className="admin-btn admin-btn-primary text-xs" disabled={!motivo.trim() || m.isPending} onClick={() => m.mutate()}>
          Adiar
        </button>
      </div>
    </div>
  );
}

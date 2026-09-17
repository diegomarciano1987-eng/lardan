import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { criarFollowup, FOLLOWUP_TIPOS, type Opcoes } from "@/lib/crm/api";

/** Data/hora locais em formato aceito pelo campo, já no fuso de operação. */
function agoraLocal(horasAdiante = 1) {
  const d = new Date(Date.now() + horasAdiante * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Agendamento rápido de retorno. Serve tanto no quadro (sem abrir a ficha)
 * quanto dentro do cockpit da candidata.
 */
export function FollowupDialog({
  leadId,
  nome,
  opcoes,
  aberto,
  onFechar,
}: {
  leadId: string;
  nome: string;
  opcoes: Opcoes | undefined;
  aberto: boolean;
  onFechar: () => void;
}) {
  const qc = useQueryClient();
  const [quando, setQuando] = useState(agoraLocal(1));
  const [tipo, setTipo] = useState("whatsapp");
  const [responsavel, setResponsavel] = useState("");
  const [observacao, setObservacao] = useState("");

  const salvar = useMutation({
    mutationFn: () =>
      criarFollowup({
        lead: leadId,
        quando: new Date(quando).toISOString(),
        tipo,
        responsavel: responsavel || null,
        observacao: observacao || null,
      }),
    onSuccess: async () => {
      toast.success("Follow-up agendado.");
      await qc.invalidateQueries({ queryKey: ["crm"] });
      setObservacao("");
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="admin-scope max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar follow-up</DialogTitle>
          <DialogDescription>{nome}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="fu-quando" className="ledger-eyebrow mb-1.5 block">
              Data e hora
            </label>
            <input
              id="fu-quando"
              type="datetime-local"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ledger-text"
            />
          </div>
          <div>
            <span className="ledger-eyebrow mb-1.5 block">Tipo</span>
            <SmartSelect
              value={tipo}
              onChange={setTipo}
              options={FOLLOWUP_TIPOS.map((t) => ({ value: t.valor, label: t.rotulo }))}
            />
          </div>
          <div>
            <span className="ledger-eyebrow mb-1.5 block">Responsável</span>
            <SmartSelect
              value={responsavel}
              onChange={setResponsavel}
              placeholder="Eu mesmo"
              options={(opcoes?.usuarios ?? []).map((u) => ({ value: u.id, label: u.nome }))}
            />
          </div>
          <div>
            <label htmlFor="fu-obs" className="ledger-eyebrow mb-1.5 block">
              Observação
            </label>
            <textarea
              id="fu-obs"
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ledger-text"
            />
          </div>
        </div>

        <DialogFooter>
          <button type="button" className="admin-btn" onClick={onFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            disabled={salvar.isPending || !quando}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? "Agendando…" : "Agendar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { CheckCircle2, Clock3, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export const PRAZO_RESPOSTA_DIAS = 3;

export function CandidaturaRecebidaDialog({
  open,
  protocolo,
  reenvio,
  onClose,
}: {
  open: boolean;
  protocolo: string;
  reenvio: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border-primary/20 p-0 shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="bg-gradient-to-b from-primary/15 to-transparent px-6 pb-2 pt-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 ring-8 ring-primary/5">
            <CheckCircle2 className="h-9 w-9 text-primary" aria-hidden />
          </div>
          <p className="brand-eyebrow mt-5">{reenvio ? "Candidatura atualizada" : "Candidatura enviada"}</p>
          <DialogTitle className="mt-2 text-2xl leading-tight text-foreground">
            Está tudo certo! Recebemos os seus dados
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Obrigada pelo interesse em ser Consultora Lardan. A nossa equipe vai analisar a sua candidatura com carinho.
          </DialogDescription>
        </div>
        <div className="space-y-3 px-6 py-4">
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm text-foreground">
              Você será respondida em <strong>no máximo {PRAZO_RESPOSTA_DIAS} dias</strong>.
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <p className="text-sm text-foreground">Fique de olho no seu WhatsApp e no seu e-mail.</p>
          </div>
          <p className="pt-1 text-center text-xs text-muted-foreground">
            Protocolo <strong className="text-foreground">{protocolo}</strong>
          </p>
        </div>
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-full bg-primary text-base font-medium text-primary-foreground transition hover:opacity-90"
          >
            Entendi, vou aguardar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

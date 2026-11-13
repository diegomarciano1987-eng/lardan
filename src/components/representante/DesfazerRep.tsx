/** 0315 — no app do representante: desfazer a troca de maleta feita por engano (antes do aceite da consultora). */
import * as React from "react";
import { ChevronDown, Undo2 } from "lucide-react";
import { DesfazerMovimentos } from "@/components/admin/maletas/DesfazerMovimentos";

export function DesfazerRep({ rep }: { rep: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <section className="rounded-2xl border border-border bg-card">
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span className="flex items-center gap-2">
          <Undo2 aria-hidden className="size-5 text-primary" />
          <span>
            <span className="block text-base font-semibold">Passou a maleta para a pessoa errada?</span>
            <span className="block text-sm text-muted-foreground">Desfaça aqui. Depois que ela aceita no app, só a equipe da Lardan desfaz.</span>
          </span>
        </span>
        <ChevronDown aria-hidden className={`size-5 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && <div className="border-t border-border p-4"><DesfazerMovimentos rep={rep} compacto /></div>}
    </section>
  );
}

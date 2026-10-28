import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import { lerImpressoras, type DestinoImpressao } from "@/lib/impressoras";

/** Browser printing cannot enumerate/select devices. Always confirm the intended destination. */
export function confirmarImpressora(destino: DestinoImpressao): Promise<boolean> {
  const config = lerImpressoras();
  return new Promise((resolve) => {
    const host = document.createElement("div"); document.body.appendChild(host);
    const root = createRoot(host);
    let terminou = false;
    const fechar = (ok: boolean) => {
      if (terminou) return; terminou = true;
      resolve(ok); window.setTimeout(() => { root.unmount(); host.remove(); }, 0);
    };
    root.render(<Dialog open onOpenChange={(open) => { if (!open) fechar(false); }}>
      <DialogContent className="admin-scope z-[200] max-w-lg text-ledger-text">
        <DialogHeader><DialogTitle>{destino === "a4" ? "Imprimir documento A4" : "Imprimir etiquetas"}</DialogTitle>
          <DialogDescription>Confirme o destino na janela de impressão do navegador.</DialogDescription></DialogHeader>
        <p className="text-lg font-semibold">{config[destino] || "Impressora ainda não configurada nesta estação"}</p>
        <p className="text-sm text-ledger-muted">{destino === "a4" ? "Papel A4 · retrato · escala 100% · sem cabeçalhos e rodapés do navegador." : "Argox · suporte 100 × 15 mm (etiqueta 95 × 12 mm e intervalo 3 mm) · escala 100% · sem margens."}</p>
        <p className="text-sm text-ledger-muted">O LARDAN lembra o nome indicado, mas não consegue selecionar uma impressora pelo navegador. Não use impressão automática nesta estação com dois destinos diferentes.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => fechar(false)}>Cancelar</Button><Button onClick={() => fechar(true)}><Printer />Abrir impressão</Button></div>
      </DialogContent>
    </Dialog>);
  });
}
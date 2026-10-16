import * as React from "react";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function LeitorEtiqueta({ encontrado }: { encontrado: (codigo: string) => void }) {
  const [aberto, setAberto] = React.useState(false);
  const [erro, setErro] = React.useState("");
  const [codigo, setCodigo] = React.useState("");
  const video = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    if (!aberto) return;
    let cancelado = false; let controles: { stop: () => void } | undefined;
    void import("@zxing/browser").then(async ({ BrowserMultiFormatReader }) => {
      if (cancelado || !video.current) return;
      try {
        controles = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current, (resultado, _erro, ctrl) => {
          if (resultado && !cancelado) { cancelado = true; ctrl.stop(); encontrado(resultado.getText()); setAberto(false); }
        });
        if (cancelado) controles.stop();
      } catch { if (!cancelado) setErro("Câmera indisponível. Digite o código da etiqueta."); }
    });
    return () => { cancelado = true; controles?.stop(); };
  }, [aberto, encontrado]);
  return <>
    <Button variant="outline" className="min-h-12" onClick={() => { setErro(""); setAberto(true); }}><Camera /> Ler etiqueta</Button>
    <Dialog open={aberto} onOpenChange={setAberto}><DialogContent><DialogHeader><DialogTitle>Ler etiqueta</DialogTitle><DialogDescription>Código da peça que está na sua maleta</DialogDescription></DialogHeader>
      <video ref={video} muted playsInline className="aspect-square w-full rounded-lg bg-muted object-cover" />
      {erro && <p role="alert">{erro}</p>}
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (codigo.trim()) { encontrado(codigo.trim()); setAberto(false); } }}><label htmlFor="codigo-etiqueta">Código da etiqueta</label><input id="codigo-etiqueta" className="admin-input min-h-12" value={codigo} onChange={(e) => setCodigo(e.target.value)} /><Button type="submit" disabled={!codigo.trim()}>Buscar na maleta</Button></form>
    </DialogContent></Dialog>
  </>;
}
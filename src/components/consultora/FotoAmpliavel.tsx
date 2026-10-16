import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function FotoAmpliavel({ mediaId, variantId, nome }: { mediaId?: string | null; variantId: string; nome: string }) {
  const [aberta, setAberta] = React.useState(false);
  return <>
    <Button type="button" variant="ghost" className="size-24 shrink-0 overflow-hidden p-0" aria-label={`Ampliar foto de ${nome}`} onClick={() => setAberta(true)}>
      <FotoPeca mediaId={mediaId} variantId={variantId} alt={nome} className="size-24 rounded-lg" />
    </Button>
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogContent className="h-[95dvh] w-[95vw] max-w-5xl grid-rows-[auto_minmax(0,1fr)] p-6">
        <DialogHeader className="pr-10"><DialogTitle>{nome}</DialogTitle><DialogDescription>Foto da peça</DialogDescription></DialogHeader>
        <FotoPeca mediaId={mediaId} variantId={variantId} alt={nome} className="h-full w-full min-h-0 object-contain" />
      </DialogContent>
    </Dialog>
  </>;
}
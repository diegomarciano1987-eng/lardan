import * as React from "react";
import { Camera, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecorteFoto } from "@/components/vitrine/RecorteFoto";
import { abrirImagem, gerarTamanhos } from "@/lib/vitrine-imagem";
import { fotoPecaRemover, fotoPecaSalvar, type Recorte } from "@/lib/vitrine-design";
import { traduzir } from "@/lib/maletas";

/**
 * 0298: a consultora fotografa a peça. A foto é recortada em quadrado no próprio
 * aparelho (sem GPS nem dados da câmera), fica na pasta privada dela e aparece só
 * na vitrine dela. O catálogo oficial da Lardan não muda.
 */
export function FotoPropriaPeca({ party, variantId, produto, temPropria, temOficial, onMudou }: {
  party: string;
  variantId: string;
  produto: string;
  temPropria: boolean;
  temOficial: boolean;
  onMudou: (path: string | null) => void | Promise<void>;
}) {
  const camera = React.useRef<HTMLInputElement>(null);
  const galeria = React.useRef<HTMLInputElement>(null);
  const [bmp, setBmp] = React.useState<ImageBitmap | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const abrir = async (f?: File) => {
    if (!f) return;
    try { setBmp(await abrirImagem(f)); } catch (e) { toast.error((e as Error).message); }
  };
  const confirmar = async (r: Recorte) => {
    if (!bmp) return;
    setOcupado(true);
    try {
      const [blob] = (await gerarTamanhos(bmp, r, [{ w: 1080, h: 1080 }])) as [Blob];
      const path = await fotoPecaSalvar(party, variantId, blob);
      await onMudou(path);
      setBmp(null);
      toast.success("Foto pronta. Ela aparece só na sua vitrine.");
    } catch (e) {
      toast.error(`Não foi possível guardar a foto: ${traduzir(e)}. Tente de novo.`);
    } finally { setOcupado(false); }
  };
  const remover = async () => {
    setOcupado(true);
    try {
      await fotoPecaRemover(variantId);
      await onMudou(null);
      toast.success(temOficial ? "Sua foto saiu. A vitrine volta a mostrar a foto oficial." : "Sua foto saiu da vitrine.");
    } catch (e) { toast.error(traduzir(e)); } finally { setOcupado(false); }
  };

  return (
    <div className="rounded-lg border border-dashed border-line-soft p-3">
      <p className="text-xs font-medium">{temPropria ? "Esta peça usa a sua foto" : temOficial ? "Quer usar uma foto sua?" : "Esta peça está sem foto"}</p>
      <p className="mt-0.5 text-[0.7rem] text-ledger-muted">A foto aparece só na sua vitrine. As outras consultoras e a Lardan continuam com a foto oficial.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="admin-btn text-xs" disabled={ocupado} onClick={() => camera.current?.click()}>
          <Camera className="size-3.5" /> {temPropria ? "Tirar outra" : "Tirar foto"}
        </button>
        <button type="button" className="admin-btn text-xs" disabled={ocupado} onClick={() => galeria.current?.click()}>
          <ImagePlus className="size-3.5" /> Galeria
        </button>
        {temPropria && (
          <button type="button" className="admin-btn text-xs" disabled={ocupado} onClick={() => void remover()}>
            {ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} {temOficial ? "Voltar à foto oficial" : "Excluir minha foto"}
          </button>
        )}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void abrir(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void abrir(e.target.files?.[0]); e.target.value = ""; }} />

      <Dialog open={!!bmp} onOpenChange={(o) => { if (!o && !ocupado) setBmp(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enquadre a peça</DialogTitle>
            <DialogDescription>{produto}. Deixe a peça no centro, com fundo limpo e luz natural.</DialogDescription>
          </DialogHeader>
          {bmp && (
            <RecorteFoto img={bmp} proporcao={1} minimo={600} confirmando={ocupado}
              onCancelar={() => setBmp(null)} onConfirmar={(r) => void confirmar(r)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecorteFoto } from "@/components/vitrine/RecorteFoto";
import { abrirImagem, gerarTamanhos } from "@/lib/vitrine-imagem";
import type { Recorte } from "@/lib/vitrine-design";
import { fetchMyProfile, signedAvatarUrl, uploadAvatar } from "@/lib/profile";

const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/** Foto da consultora — usada no menu e, no futuro, em rankings. */
export function AvatarConsultora({ tamanho = "grande" }: { tamanho?: "grande" | "pequeno" }) {
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const perfil = useQuery({ queryKey: ["meu-perfil"], queryFn: fetchMyProfile });
  const foto = useQuery({
    queryKey: ["meu-perfil", "foto", perfil.data?.avatar_url],
    queryFn: () => signedAvatarUrl(perfil.data?.avatar_url ?? null),
    enabled: !!perfil.data?.avatar_url,
    staleTime: 50 * 60 * 1000,
  });
  const [img, setImg] = React.useState<ImageBitmap | null>(null);
  const escolher = async (f: File) => {
    try { setImg(await abrirImagem(f)); } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir a foto."); }
  };
  const enviar = useMutation({
    mutationFn: async (r: Recorte) => {
      if (!img) throw new Error("Escolha uma foto.");
      const [blob] = await gerarTamanhos(img, r, [{ w: 640, h: 640 }]);
      return uploadAvatar(new File([blob!], "foto.webp", { type: "image/webp" }));
    },
    onSuccess: () => { setImg(null); toast.success("Foto atualizada."); void qc.invalidateQueries({ queryKey: ["meu-perfil"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto."),
  });
  const nome = perfil.data?.display_name || perfil.data?.full_name || "";
  const iniciais = nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
  const grande = tamanho === "grande";
  const url = perfil.data?.avatar_url ? foto.data : null;

  const circulo = (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-primary/40 bg-primary/10 font-semibold text-primary ${grande ? "size-20 text-2xl" : "size-11 text-base"}`}>
      {url ? <img src={url} alt={`Foto de ${nome || "consultora"}`} className="size-full object-cover" /> : <span aria-hidden>{iniciais}</span>}
      {enviar.isPending && <span className="absolute inset-0 grid place-items-center bg-background/70"><span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></span>}
      <span className={`absolute bottom-0 right-0 grid place-items-center rounded-full bg-acao text-acao-foreground ${grande ? "size-7" : "size-4"}`} aria-hidden><Camera className={grande ? "size-4" : "size-2.5"} /></span>
    </span>
  );

  return (
    <>
      <input ref={input} type="file" accept={TIPOS.join(",")} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void escolher(f); e.target.value = ""; }} />
      {grande ? (
        <button type="button" onClick={() => input.current?.click()} disabled={enviar.isPending}
          className="mb-6 flex w-full items-center gap-4 rounded-2xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted">
          {circulo}
          <span className="min-w-0">
            <span className="block truncate text-lg font-semibold">{nome || "Consultora"}</span>
            <span className="block text-sm text-muted-foreground">{url ? "Trocar minha foto" : "Colocar minha foto"}</span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={enviar.isPending}
          aria-label={url ? "Trocar minha foto" : "Colocar minha foto"} className="grid size-12 place-items-center rounded-full">
          {circulo}
        </button>
      )}
      <Dialog open={!!img} onOpenChange={(o) => { if (!o && !enviar.isPending) setImg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajustar minha foto</DialogTitle><DialogDescription>Arraste para centralizar, aproxime e gire até ficar perfeita.</DialogDescription></DialogHeader>
          {img && <RecorteFoto img={img} proporcao={1} redondo minimo={320} confirmando={enviar.isPending} onCancelar={() => setImg(null)} onConfirmar={(r) => enviar.mutate(r)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

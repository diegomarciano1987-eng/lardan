import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { FORMATOS, listarArtes } from "@/lib/biblioteca";

/** Artes da semana publicadas pela LARDAN: baixar, compartilhar e copiar a legenda. */
export function ArtesSemana() {
  const q = useQuery({ queryKey: ["consultora", "biblioteca-artes"], queryFn: () => listarArtes(true) });
  const compartilhar = async (url: string, titulo: string, legenda: string) => {
    try {
      const blob = await (await fetch(url)).blob();
      const arq = new File([blob], `${titulo}.${blob.type.split("/")[1] ?? "jpg"}`, { type: blob.type });
      if (navigator.canShare?.({ files: [arq] })) { await navigator.share({ files: [arq], text: legenda }); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = arq.name; a.click();
    } catch { /* cancelado */ }
  };
  return (
    <section aria-labelledby="artes" className="rounded-2xl border border-border bg-card px-5 py-5">
      <h2 id="artes" className="text-xl font-semibold">Artes da semana</h2>
      <p className="text-[1rem] text-muted-foreground">Imagens oficiais para seus stories, feed e status.</p>
      {q.isLoading && <p className="mt-3 text-base">Carregando…</p>}
      {q.data?.length === 0 && <p className="mt-3 text-base">Sem artes publicadas no momento.</p>}
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {q.data?.map((a) => a.url && (
          <li key={a.id} className="min-w-0 overflow-hidden rounded-2xl border border-border">
            {a.path.endsWith(".mp4") ? <video src={a.url} controls className="aspect-[4/5] w-full bg-muted object-cover" /> : a.path.endsWith(".pdf") ? <div className="grid aspect-[4/5] place-items-center bg-muted">PDF</div> : <img src={a.url} alt={a.titulo} className="aspect-[4/5] w-full bg-muted object-cover" loading="lazy" />}
            <div className="space-y-2 p-3">
              <p className="text-[1rem] font-semibold leading-snug">{a.titulo}</p>
              <p className="text-[0.9rem] text-muted-foreground">{FORMATOS[a.formato]}</p>
              <button type="button" className="btn-app-principal w-full" onClick={() => void compartilhar(a.url!, a.titulo, a.legenda)}><Share2 className="size-5" aria-hidden /> Compartilhar</button>
              <a href={a.url} download className="admin-btn min-h-12 w-full justify-center text-base"><Download className="size-5" aria-hidden /> Baixar</a>
              {a.legenda && <button type="button" className="admin-btn min-h-12 w-full justify-center text-base" onClick={() => { void navigator.clipboard.writeText(a.legenda); toast.success("Legenda copiada."); }}><Copy className="size-5" aria-hidden /> Copiar legenda</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

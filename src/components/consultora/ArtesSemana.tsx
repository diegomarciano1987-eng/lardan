import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Share2, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TIPOS, listarArtes, type TipoConteudo } from "@/lib/biblioteca";

export function ArtesSemana() {
  const [tipo, setTipo] = useState<TipoConteudo>("campanha");
  const q = useQuery({ queryKey: ["consultora", "biblioteca-artes", tipo], queryFn: () => listarArtes(true, tipo) });
  const baixar = async (url: string, titulo: string, path: string, compartilhar = false, legenda = "") => {
    let local: string | undefined;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("Arquivo indisponível.");
      const blob = await r.blob();
      const arq = new File([blob], `${titulo.replace(/[/\\]/g, "-")}.${path.split(".").pop() ?? "pdf"}`, { type: blob.type });
      if (compartilhar && navigator.canShare?.({ files: [arq] })) { await navigator.share({ files: [arq], title: titulo, text: legenda }); return; }
      local = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = local; a.download = arq.name; document.body.append(a); a.click(); a.remove();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("Não foi possível obter o arquivo. Tente novamente.");
    } finally { if (local) setTimeout(() => URL.revokeObjectURL(local ?? ""), 1000); }
  };
  return (
    <section aria-labelledby="conteudos-biblioteca" className="min-w-0 space-y-5">
      <h2 id="conteudos-biblioteca" className="text-xl font-semibold">Conteúdos LARDAN</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Categorias da Biblioteca">
        {Object.entries(TIPOS).map(([v, label]) => <Button key={v} variant={tipo === v ? "default" : "outline"} aria-pressed={tipo === v} className="h-auto min-h-12 whitespace-normal px-3 py-3 text-base" onClick={() => setTipo(v as TipoConteudo)}>{label}</Button>)}
      </div>
      {q.isLoading && <p role="status" className="text-lg text-muted-foreground">Carregando…</p>}
      {q.error && <div role="alert" className="space-y-3"><p className="text-lg">Não foi possível carregar os conteúdos.</p><Button variant="outline" onClick={() => void q.refetch()}>Tentar novamente</Button></div>}
      {!q.isLoading && !q.error && !q.data?.length && <p className="py-4 text-lg text-muted-foreground">Sem dados: nenhum conteúdo publicado nesta categoria.</p>}
      <ul className={tipo === "arte" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-4 lg:grid-cols-2"}>
        {q.data?.map((a) => (
          <li key={a.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            {a.url && tipo === "arte" && !a.path.endsWith(".pdf") && (a.path.endsWith(".mp4") ? <video src={a.url} controls preload="metadata" className="aspect-[4/5] w-full bg-muted object-contain" /> : <img src={a.url} alt={a.titulo} className="aspect-[4/5] w-full bg-muted object-contain" loading="lazy" />)}
            <div className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                {(tipo !== "arte" || a.path.endsWith(".pdf")) && <FileText className="mt-1 size-6 shrink-0 text-primary" aria-hidden />}
                <div className="min-w-0"><h3 className="break-words text-lg font-semibold">{a.titulo}</h3><p className="mt-1 text-base text-muted-foreground">{a.path.split(".").pop()?.toUpperCase()} · {new Date(a.semana + "T12:00:00").toLocaleDateString("pt-BR")}</p></div>
              </div>
              {a.legenda && <p className="whitespace-pre-line break-words text-lg text-muted-foreground">{a.legenda}</p>}
              {a.url ? <>
                <Button asChild className="min-h-12 w-full text-base"><a href={a.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Abrir {a.path.endsWith(".pdf") ? "PDF" : "arquivo"}</a></Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="min-h-12 px-2 text-base" onClick={() => { if (a.url) void baixar(a.url, a.titulo, a.path); }}><Download aria-hidden /> Baixar</Button>
                  <Button variant="outline" className="min-h-12 px-2 text-base" onClick={() => { if (a.url) void baixar(a.url, a.titulo, a.path, true, a.legenda); }}><Share2 aria-hidden /> Enviar</Button>
                </div>
              </> : <p role="alert" className="text-base text-muted-foreground">Arquivo indisponível no momento.</p>}
              {tipo === "arte" && a.legenda && <Button variant="ghost" className="min-h-12 w-full text-base" onClick={() => { void navigator.clipboard.writeText(a.legenda).then(() => toast.success("Legenda copiada.")).catch(() => toast.error("Não foi possível copiar.")); }}><Copy aria-hidden /> Copiar legenda</Button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

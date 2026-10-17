import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { PageHeader, Panel, Skeleton, ErrorState } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { Button } from "@/components/ui/button";
import { FORMATOS, TIPOS, enviarArte, listarArtes, publicarArte, type Arte, type TipoConteudo } from "@/lib/biblioteca";

export const Route = createFileRoute("/_authenticated/admin/biblioteca")({
  head: () => ({ meta: [{ title: "Biblioteca LARDAN — Conteúdos e documentos" }, { name: "description", content: "Gestão de artes, campanhas, informativos e materiais das consultoras LARDAN." }, { property: "og:title", content: "Biblioteca LARDAN — Conteúdos e documentos" }, { property: "og:description", content: "Artes e documentos oficiais para as consultoras LARDAN." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminBiblioteca,
});

const isoDia = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function AdminBiblioteca() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = React.useState<TipoConteudo | undefined>();
  const q = useQuery({ queryKey: ["admin", "biblioteca", filtro], queryFn: () => listarArtes(false, filtro) });
  const [tipo, setTipo] = React.useState<TipoConteudo>("arte");
  const arquivoInput = React.useRef<HTMLInputElement>(null);
  const [titulo, setTitulo] = React.useState("");
  const [legenda, setLegenda] = React.useState("");
  const [formato, setFormato] = React.useState<Arte["formato"]>("story");
  const [semana, setSemana] = React.useState<Date | undefined>(new Date());
  const [arq, setArq] = React.useState<File | null>(null);
  const enviar = useMutation({
    mutationFn: () => {
      if (!arq) throw new Error("Escolha o arquivo do conteúdo.");
      if (titulo.trim().length < 2) throw new Error("Dê um título ao conteúdo.");
      return enviarArte(arq, { titulo, legenda, tipo, formato, semana: isoDia(semana ?? new Date()) });
    },
    onSuccess: () => { toast.success("Conteúdo salvo como rascunho."); setTitulo(""); setLegenda(""); setArq(null); if (arquivoInput.current) arquivoInput.current.value = ""; void qc.invalidateQueries({ queryKey: ["admin", "biblioteca"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pub = useMutation({
    mutationFn: (v: { id: string; p: boolean }) => publicarArte(v.id, v.p),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "biblioteca"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Conteúdo" title="Biblioteca LARDAN" description="Artes · Campanhas · Informativos · Manuais e materiais" />
      <Panel title="Novo conteúdo">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1 text-sm">Categoria<SmartSelect value={tipo} onChange={(v) => setTipo(v as TipoConteudo)} options={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))} /></div>
          <label className="grid gap-1 text-sm">Título<input className="admin-input" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Lançamento coleção Fé" /></label>
          {tipo === "arte" && <div className="grid gap-1 text-sm">Formato<SmartSelect value={formato} onChange={(v) => setFormato(v as Arte["formato"])} options={Object.entries(FORMATOS).map(([value, label]) => ({ value, label }))} /></div>}
          <label className="grid gap-1 text-sm md:col-span-2">{tipo === "arte" ? "Legenda sugerida" : "Descrição"}<textarea className="admin-input min-h-24" value={legenda} maxLength={1000} onChange={(e) => setLegenda(e.target.value)} /></label>
          <div className="grid gap-1 text-sm">{tipo === "arte" ? "Semana" : "Data do conteúdo"}<DateField value={semana} onChange={setSemana} /></div>
          <label className="grid gap-1 text-sm">Arquivo (JPG, PNG, WEBP, MP4 ou PDF, até 25 MB)
            <input ref={arquivoInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" className="admin-input" onChange={(e) => setArq(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <Button type="button" className="mt-4" disabled={enviar.isPending} onClick={() => enviar.mutate()}><Upload className="size-4" /> {enviar.isPending ? "Enviando…" : "Salvar rascunho"}</Button>
      </Panel>
      <Panel title="Conteúdos">
        <div className="mb-5 flex flex-wrap gap-2" aria-label="Categorias de conteúdo">
          <Button variant={!filtro ? "default" : "outline"} onClick={() => setFiltro(undefined)}>Todos</Button>
          {Object.entries(TIPOS).map(([v, label]) => <Button key={v} variant={filtro === v ? "default" : "outline"} onClick={() => setFiltro(v as TipoConteudo)}>{label}</Button>)}
        </div>
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <ErrorState message={String(q.error)} /> : !q.data?.length ? <p className="text-sm text-ledger-muted">Sem dados: nenhum conteúdo nesta categoria.</p> : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {q.data.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-lg border border-line-soft">
                {a.url && (a.path.endsWith(".mp4") ? <video src={a.url} className="aspect-square w-full bg-muted object-cover" muted /> : a.path.endsWith(".pdf") ? <div className="grid aspect-square place-items-center bg-muted text-sm">PDF</div> : <img src={a.url} alt={a.titulo} className="aspect-square w-full bg-muted object-cover" />)}
                <div className="space-y-1 p-3 text-sm">
                  <p className="font-semibold break-words">{a.titulo}</p>
                  <p className="text-ledger-muted">{TIPOS[a.tipo]} · {new Date(a.semana + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                  {a.tipo === "arte" && <p className="text-ledger-muted">{FORMATOS[a.formato]}</p>}
                  {a.url && <Button asChild variant="outline" className="mt-2 w-full"><a href={a.url} target="_blank" rel="noreferrer">Abrir arquivo</a></Button>}
                  <Button type="button" variant={a.publicado ? "outline" : "default"} className="mt-2 w-full" disabled={pub.isPending} onClick={() => pub.mutate({ id: a.id, p: !a.publicado })}>{a.publicado ? "Publicado · retirar" : "Publicar"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

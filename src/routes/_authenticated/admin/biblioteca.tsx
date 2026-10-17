import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { PageHeader, Panel, Skeleton, ErrorState } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { FORMATOS, enviarArte, listarArtes, publicarArte, type Arte } from "@/lib/biblioteca";

export const Route = createFileRoute("/_authenticated/admin/biblioteca")({
  head: () => ({ meta: [{ title: "Biblioteca LARDAN — Painel Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminBiblioteca,
});

const isoDia = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function AdminBiblioteca() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "biblioteca"], queryFn: () => listarArtes(false) });
  const [titulo, setTitulo] = React.useState("");
  const [legenda, setLegenda] = React.useState("");
  const [formato, setFormato] = React.useState<Arte["formato"]>("story");
  const [semana, setSemana] = React.useState<Date | undefined>(new Date());
  const [arq, setArq] = React.useState<File | null>(null);
  const enviar = useMutation({
    mutationFn: () => {
      if (!arq) throw new Error("Escolha o arquivo da arte.");
      if (titulo.trim().length < 2) throw new Error("Dê um título à arte.");
      return enviarArte(arq, { titulo, legenda, formato, semana: isoDia(semana ?? new Date()) });
    },
    onSuccess: () => { toast.success("Arte enviada como rascunho. Publique para as consultoras verem."); setTitulo(""); setLegenda(""); setArq(null); void qc.invalidateQueries({ queryKey: ["admin", "biblioteca"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const pub = useMutation({
    mutationFn: (v: { id: string; p: boolean }) => publicarArte(v.id, v.p),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "biblioteca"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Conteúdo" title="Biblioteca LARDAN" description="Artes da semana para as consultoras baixarem e postarem. Rascunhos ficam invisíveis até a publicação." />
      <Panel title="Nova arte">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">Título<input className="admin-input" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Lançamento coleção Fé" /></label>
          <div className="grid gap-1 text-sm">Formato<SmartSelect value={formato} onChange={(v) => setFormato(v as Arte["formato"])} options={Object.entries(FORMATOS).map(([value, label]) => ({ value, label }))} /></div>
          <label className="grid gap-1 text-sm md:col-span-2">Legenda sugerida<textarea className="admin-input min-h-24" value={legenda} maxLength={1000} onChange={(e) => setLegenda(e.target.value)} placeholder="Texto que a consultora copia junto com a arte" /></label>
          <div className="grid gap-1 text-sm">Semana<DateField value={semana} onChange={setSemana} /></div>
          <label className="grid gap-1 text-sm">Arquivo (JPG, PNG, WEBP, MP4 ou PDF, até 25 MB)
            <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" className="admin-input" onChange={(e) => setArq(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <button type="button" className="admin-btn admin-btn-primary mt-4" disabled={enviar.isPending} onClick={() => enviar.mutate()}><Upload className="size-4" /> {enviar.isPending ? "Enviando…" : "Enviar arte"}</button>
      </Panel>
      <Panel title="Artes">
        {q.isLoading ? <Skeleton className="h-40" /> : q.error ? <ErrorState message={String(q.error)} /> : q.data!.length === 0 ? <p className="text-sm text-ledger-muted">Sem dados: nenhuma arte enviada ainda.</p> : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {q.data!.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-xl border border-line-soft">
                {a.url && (a.path.endsWith(".mp4") ? <video src={a.url} className="aspect-square w-full bg-muted object-cover" muted /> : a.path.endsWith(".pdf") ? <div className="grid aspect-square place-items-center bg-muted text-sm">PDF</div> : <img src={a.url} alt={a.titulo} className="aspect-square w-full bg-muted object-cover" />)}
                <div className="space-y-1 p-3 text-sm">
                  <p className="font-semibold">{a.titulo}</p>
                  <p className="text-ledger-muted">{FORMATOS[a.formato]} · semana de {new Date(a.semana + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                  <button type="button" className={`admin-btn mt-2 w-full justify-center ${a.publicado ? "" : "admin-btn-primary"}`} disabled={pub.isPending} onClick={() => pub.mutate({ id: a.id, p: !a.publicado })}>{a.publicado ? "Publicada · retirar" : "Publicar"}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

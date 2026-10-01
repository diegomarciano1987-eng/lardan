import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CorpoArtigo, type ArtigoAjuda } from "@/components/ajuda/Ajuda";

export const Route = createFileRoute("/_authenticated/admin/ajuda")({
  head: () => ({ meta: [{ title: "Central de Ajuda — Painel Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminAjuda,
});

// Telas da consultora que têm (ou devem ter) orientação ligada.
const TELAS = ["convite", "login", "maleta", "vitrine", "pedidos"] as const;

const tabela = () => supabase.from("help_articles" as never);

function AdminAjuda() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "ajuda"],
    queryFn: async () => {
      const { data, error } = await tabela().select("*").order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as ArtigoAjuda[];
    },
  });
  const [edit, setEdit] = React.useState<Partial<ArtigoAjuda> | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const artigos = q.data ?? [];
  const semArtigo = TELAS.filter((t) => !artigos.some((a) => a.tela === t && a.status === "publicado"));

  const salvar = async () => {
    if (!edit?.titulo?.trim() || !edit.slug?.trim() || !edit.categoria?.trim()) { toast.error("Preencha título, identificador e assunto."); return; }
    setSalvando(true);
    const linha = {
      slug: edit.slug.trim(), titulo: edit.titulo.trim(), categoria: edit.categoria.trim(), tela: edit.tela || null,
      publico: edit.publico ?? "consultora", resumo: edit.resumo ?? "", corpo: edit.corpo ?? "",
      status: edit.status ?? "rascunho", ordem: Number(edit.ordem ?? 100), revisado_em: new Date().toISOString().slice(0, 10),
    };
    const r = edit.id ? await tabela().update(linha as never).eq("id", edit.id) : await tabela().insert(linha as never);
    setSalvando(false);
    if (r.error) { toast.error("Não salvou: " + r.error.message); return; }
    toast.success("Artigo salvo."); setEdit(null);
    qc.invalidateQueries({ queryKey: ["admin", "ajuda"] }); qc.invalidateQueries({ queryKey: ["ajuda"] });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ledger-eyebrow">Conteúdo</p>
          <h1 className="font-display text-3xl">Central de Ajuda</h1>
          <p className="text-sm text-ledger-muted">Só artigos publicados aparecem. “Público” é visto por qualquer visitante; “Consultora” só depois de entrar.</p>
        </div>
        <button className="admin-btn-primary" onClick={() => setEdit({ publico: "consultora", status: "rascunho", ordem: 100 })}>Novo artigo</button>
      </header>

      {semArtigo.length > 0 && (
        <p className="rounded-xl border border-line p-4 text-sm">Telas sem artigo publicado: <strong>{semArtigo.join(", ")}</strong></p>
      )}

      {edit && (
        <section className="grid gap-3 rounded-2xl border border-line-soft bg-surface p-5 md:grid-cols-2">
          <Campo r="Título"><input className="admin-input" value={edit.titulo ?? ""} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} /></Campo>
          <Campo r="Identificador (sem espaços)"><input className="admin-input" value={edit.slug ?? ""} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Campo>
          <Campo r="Assunto"><input className="admin-input" value={edit.categoria ?? ""} onChange={(e) => setEdit({ ...edit, categoria: e.target.value })} /></Campo>
          <Campo r="Ordem"><input className="admin-input" inputMode="numeric" value={String(edit.ordem ?? 100)} onChange={(e) => setEdit({ ...edit, ordem: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></Campo>
          <Escolha r="Tela relacionada" valor={edit.tela ?? ""} opcoes={[["", "Nenhuma"], ...TELAS.map((t) => [t, t] as [string, string])]} muda={(v) => setEdit({ ...edit, tela: v || null })} />
          <Escolha r="Público" valor={edit.publico ?? "consultora"} opcoes={[["consultora", "Consultora"], ["publico", "Público"]]} muda={(v) => setEdit({ ...edit, publico: v as ArtigoAjuda["publico"] })} />
          <Escolha r="Situação" valor={edit.status ?? "rascunho"} opcoes={[["rascunho", "Rascunho"], ["publicado", "Publicado"]]} muda={(v) => setEdit({ ...edit, status: v as ArtigoAjuda["status"] })} />
          <Campo r="Resumo"><input className="admin-input" value={edit.resumo ?? ""} onChange={(e) => setEdit({ ...edit, resumo: e.target.value })} /></Campo>
          <div className="md:col-span-2">
            <Campo r="Texto (linha em branco separa parágrafos; “1. ” cria passos numerados)">
              <textarea className="admin-input min-h-56" value={edit.corpo ?? ""} onChange={(e) => setEdit({ ...edit, corpo: e.target.value })} />
            </Campo>
          </div>
          <div className="md:col-span-2 rounded-xl border border-line-soft p-4"><p className="mb-2 text-sm text-ledger-muted">Prévia</p><CorpoArtigo texto={edit.corpo ?? ""} /></div>
          <div className="flex gap-2 md:col-span-2">
            <button className="admin-btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar artigo"}</button>
            <button className="admin-btn" onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <ul className="space-y-2">
        {artigos.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface p-4">
            <div className="min-w-0">
              <p className="font-semibold">{a.titulo}</p>
              <p className="text-sm text-ledger-muted">{a.categoria} · {a.publico === "publico" ? "Público" : "Consultora"} · {a.status === "publicado" ? "Publicado" : "Rascunho"} · tela {a.tela ?? "—"} · revisado {new Date(a.revisado_em + "T12:00:00").toLocaleDateString("pt-BR")}</p>
            </div>
            <button className="admin-btn" onClick={() => setEdit(a)}>Editar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Campo({ r, children }: { r: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-sm font-medium">{r}{children}</label>;
}

function Escolha({ r, valor, opcoes, muda }: { r: string; valor: string; opcoes: [string, string][]; muda: (v: string) => void }) {
  return (
    <div className="grid gap-1 text-sm font-medium" role="radiogroup" aria-label={r}>
      {r}
      <div className="flex flex-wrap gap-2">
        {opcoes.map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={valor === v} onClick={() => muda(v)}
            className={`min-h-11 rounded-lg border px-3 ${valor === v ? "border-ink bg-ink text-warm-ivory" : "border-line bg-surface"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

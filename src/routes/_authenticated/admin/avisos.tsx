import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, ShieldAlert, Users } from "lucide-react";
import { DateField } from "@/components/premium/DateField";
import {
  enviarImagemAviso, listarAvisosGestao, relatorioAviso, salvarAviso, urlsImagens, ROTULO_TIPO, type Aviso, type TipoAviso,
} from "@/lib/avisos";

export const Route = createFileRoute("/_authenticated/admin/avisos")({
  head: () => ({ meta: [{ title: "Central de Avisos — Painel Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: AdminAvisos,
});

const dt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const paraData = (s: string | null | undefined) => (s ? new Date(s) : undefined);

function AdminAvisos() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "avisos"], queryFn: listarAvisosGestao });
  const [edit, setEdit] = React.useState<Partial<Aviso> | null>(null);
  const [previa, setPrevia] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [relatorio, setRelatorio] = React.useState<string | null>(null);

  const abrir = async (a: Partial<Aviso>) => {
    setEdit(a);
    setPrevia(a.imagem_path ? (await urlsImagens([a.imagem_path]))[a.imagem_path] ?? null : null);
  };

  const subir = async (f?: File) => {
    if (!f || !edit) return;
    setEnviando(true);
    try { const path = await enviarImagemAviso(f); setEdit({ ...edit, imagem_path: path }); setPrevia(URL.createObjectURL(f)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não enviou a imagem."); }
    finally { setEnviando(false); }
  };

  const salvar = async (status?: Aviso["status"]) => {
    if (!edit?.titulo?.trim()) { toast.error("Escreva o título."); return; }
    if (edit.link_url && !/^https:\/\//.test(edit.link_url.trim())) { toast.error("O link precisa começar com https://"); return; }
    setSalvando(true);
    try {
      await salvarAviso({ ...edit, status: status ?? edit.status ?? "rascunho" });
      toast.success(status === "publicado" ? "Aviso publicado para as consultoras." : "Aviso salvo.");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["admin", "avisos"] });
    } catch (e) { toast.error("Não salvou: " + (e instanceof Error ? e.message : "")); }
    finally { setSalvando(false); }
  };

  const avisos = q.data ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ledger-eyebrow">Comunicação</p>
          <h1 className="font-display text-3xl">Central de Avisos</h1>
          <p className="text-sm text-ledger-muted">Publicados aparecem em "Novidades" no app da consultora. Aviso crítico abre na tela e exige "Ciente".</p>
        </div>
        <button className="admin-btn-primary" onClick={() => void abrir({ tipo: "novidade", critico: false, status: "rascunho" })}>Novo aviso</button>
      </header>

      {edit && (
        <section className="grid gap-4 rounded-2xl border border-line-soft bg-surface p-5 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="grid gap-3">
            <Campo r="Título"><input className="admin-input" maxLength={140} value={edit.titulo ?? ""} onChange={(e) => setEdit({ ...edit, titulo: e.target.value })} /></Campo>
            <Campo r="Texto"><textarea className="admin-input min-h-40" maxLength={5000} value={edit.corpo ?? ""} onChange={(e) => setEdit({ ...edit, corpo: e.target.value })} /></Campo>
            <Escolha r="Tipo" valor={edit.tipo ?? "novidade"} opcoes={(Object.keys(ROTULO_TIPO) as TipoAviso[]).map((t) => [t, ROTULO_TIPO[t]])} muda={(v) => setEdit({ ...edit, tipo: v as TipoAviso })} />
            <label className="flex items-start gap-3 rounded-xl border border-line p-3">
              <input type="checkbox" className="mt-1 size-5" checked={!!edit.critico} onChange={(e) => setEdit({ ...edit, critico: e.target.checked })} />
              <span><span className="flex items-center gap-1 font-semibold"><ShieldAlert className="size-4" /> Aviso crítico</span>
                <span className="text-sm text-ledger-muted">Abre por cima da tela da consultora até ela tocar em "Ciente". Cada confirmação fica registrada.</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo r="Link (opcional)"><input className="admin-input" placeholder="https://" value={edit.link_url ?? ""} onChange={(e) => setEdit({ ...edit, link_url: e.target.value })} /></Campo>
              <Campo r="Texto do botão do link"><input className="admin-input" placeholder="Saiba mais" value={edit.link_rotulo ?? ""} onChange={(e) => setEdit({ ...edit, link_rotulo: e.target.value })} /></Campo>
              <div className="grid gap-1 text-sm font-medium">Mostrar a partir de
                <DateField value={paraData(edit.inicio_em)} onChange={(d) => setEdit({ ...edit, inicio_em: (d ?? new Date()).toISOString() })} />
              </div>
              <div className="grid gap-1 text-sm font-medium">Tirar do ar em (opcional)
                <DateField value={paraData(edit.fim_em)} onChange={(d) => setEdit({ ...edit, fim_em: d ? new Date(d.setHours(23, 59, 59)).toISOString() : null })} />
              </div>
            </div>
          </div>
          <div className="grid content-start gap-2">
            <p className="text-sm font-medium">Imagem</p>
            <label className="grid aspect-[4/3] cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-background">
              {previa ? <img src={previa} alt="" className="size-full object-cover" /> : <span className="grid place-items-center gap-1 text-sm text-ledger-muted"><ImagePlus className="size-6" />{enviando ? "Enviando…" : "Escolher imagem"}</span>}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void subir(e.target.files?.[0])} />
            </label>
            {previa && <button className="admin-btn" onClick={() => { setEdit({ ...edit, imagem_path: null }); setPrevia(null); }}>Remover imagem</button>}
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button className="admin-btn-primary" disabled={salvando || enviando} onClick={() => void salvar("publicado")}>Publicar</button>
            <button className="admin-btn" disabled={salvando || enviando} onClick={() => void salvar("rascunho")}>Salvar rascunho</button>
            {edit.id && <button className="admin-btn" disabled={salvando} onClick={() => void salvar("arquivado")}>Tirar do ar</button>}
            <button className="admin-btn" onClick={() => setEdit(null)}>Cancelar</button>
          </div>
        </section>
      )}

      {q.isLoading && <p role="status">Carregando…</p>}
      {q.isError && <p role="alert">Não foi possível carregar os avisos.</p>}
      {!q.isLoading && avisos.length === 0 && <p className="rounded-xl border border-line p-5">Nenhum aviso criado ainda.</p>}
      <ul className="space-y-3">
        {avisos.map((a) => (
          <li key={a.id} className="rounded-2xl border border-line-soft bg-surface p-4">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              {a.imagem_url ? <img src={a.imagem_url} alt="" className="size-16 rounded-xl object-cover" /> : <span className="grid size-16 place-items-center rounded-xl bg-background text-ledger-muted">{a.critico ? <ShieldAlert /> : "—"}</span>}
              <div className="min-w-0">
                <p className="truncate font-semibold">{a.titulo}</p>
                <p className="text-sm text-ledger-muted">{ROTULO_TIPO[a.tipo]}{a.critico ? " · Crítico" : ""} · {a.status === "publicado" ? "Publicado" : a.status === "arquivado" ? "Fora do ar" : "Rascunho"} · desde {dt(a.inicio_em)}{a.fim_em ? ` até ${dt(a.fim_em)}` : ""}</p>
              </div>
              <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1">
                <button className="admin-btn" onClick={() => setRelatorio(relatorio === a.id ? null : a.id)}><Users className="size-4" /> Quem viu</button>
                <button className="admin-btn" onClick={() => void abrir(a)}>Editar</button>
              </div>
            </div>
            {relatorio === a.id && <Relatorio id={a.id} critico={a.critico} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Relatorio({ id, critico }: { id: string; critico: boolean }) {
  const q = useQuery({ queryKey: ["admin", "avisos", "rel", id], queryFn: () => relatorioAviso(id) });
  const [filtro, setFiltro] = React.useState<"todas" | "ciente" | "pendente">("todas");
  if (q.isLoading) return <p role="status" className="mt-4 text-sm">Carregando…</p>;
  if (q.isError) return <p role="alert" className="mt-4 text-sm">Não foi possível carregar a lista.</p>;
  const linhas = q.data ?? [];
  const cientes = linhas.filter((l) => l.ciente_em).length;
  const lidas = linhas.filter((l) => l.lido_em).length;
  const total = linhas.length;
  const base = critico ? cientes : lidas;
  const vis = linhas.filter((l) => filtro === "todas" || (filtro === "ciente" ? (critico ? l.ciente_em : l.lido_em) : !(critico ? l.ciente_em : l.lido_em)));
  return (
    <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
      <p className="text-sm"><strong>{base} de {total}</strong> consultoras {critico ? "clicaram em Ciente" : "abriram"}{critico ? ` · ${lidas} abriram` : ""}.</p>
      <div className="h-2 overflow-hidden rounded-full bg-background"><div className="h-full bg-ink" style={{ width: total ? `${(base / total) * 100}%` : "0%" }} /></div>
      <Escolha r="Mostrar" valor={filtro} opcoes={[["todas", "Todas"], ["ciente", critico ? "Cientes" : "Abriram"], ["pendente", "Faltam"]]} muda={(v) => setFiltro(v as typeof filtro)} />
      {vis.length === 0 ? <p className="text-sm text-ledger-muted">Ninguém nesta lista.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ledger-muted"><th className="py-2 pr-3">Consultora</th><th className="py-2 pr-3">Abriu em</th>{critico && <th className="py-2">Ciente em</th>}</tr></thead>
            <tbody>{vis.map((l) => (
              <tr key={l.user_id} className="border-t border-line-soft">
                <td className="py-2 pr-3"><span className="font-medium">{l.nome}</span><br /><span className="text-ledger-muted">{l.email}</span></td>
                <td className="py-2 pr-3">{dt(l.lido_em)}</td>
                {critico && <td className="py-2">{l.ciente_em ? dt(l.ciente_em) : <span className="text-ledger-muted">Pendente</span>}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
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

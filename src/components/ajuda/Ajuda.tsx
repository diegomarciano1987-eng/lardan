import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleHelp, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export type ArtigoAjuda = {
  id: string;
  slug: string;
  titulo: string;
  categoria: string;
  tela: string | null;
  publico: "publico" | "consultora";
  resumo: string;
  corpo: string;
  status: "rascunho" | "publicado";
  ordem: number;
  revisado_em: string;
};

/** Lê só o que o banco libera para esta pessoa (artigos publicados do seu público). */
export async function listarAjuda(): Promise<ArtigoAjuda[]> {
  const { data, error } = await supabase
    .from("help_articles" as never)
    .select("id,slug,titulo,categoria,tela,publico,resumo,corpo,status,ordem,revisado_em")
    .eq("status", "publicado")
    .order("ordem");
  if (error) throw error;
  return (data ?? []) as unknown as ArtigoAjuda[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function filtrarAjuda(artigos: ArtigoAjuda[], busca: string) {
  const partes = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!partes.length) return artigos;
  return artigos.filter((a) => {
    const t = semAcento(`${a.titulo} ${a.categoria} ${a.resumo} ${a.corpo}`);
    return partes.every((p) => t.includes(p));
  });
}

export function CorpoArtigo({ texto }: { texto: string }) {
  return (
    <div className="space-y-3 text-base leading-relaxed text-ledger-text">
      {texto.split(/\n{2,}/).map((bloco, i) => {
        const linhas = bloco.split("\n");
        if (linhas.every((l) => /^\d+\.\s/.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-2 pl-6">
              {linhas.map((l, j) => <li key={j}>{l.replace(/^\d+\.\s/, "")}</li>)}
            </ol>
          );
        }
        return <p key={i} className="whitespace-pre-line">{bloco}</p>;
      })}
    </div>
  );
}

/** Lista pesquisável + leitura do artigo. Não navega: quem chamou continua com o formulário intacto. */
export function CentralAjuda({ tela, inicial }: { tela?: string | undefined; inicial?: string | null }) {
  const q = useQuery({ queryKey: ["ajuda"], queryFn: listarAjuda, staleTime: 5 * 60_000 });
  const [busca, setBusca] = React.useState("");
  const [aberto, setAberto] = React.useState<string | null>(inicial ?? null);
  const artigos = q.data ?? [];
  const atual = artigos.find((a) => a.slug === aberto);

  if (atual) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setAberto(null)} className="admin-btn min-h-12 text-base">
          <ArrowLeft className="size-5" aria-hidden /> Todos os assuntos
        </button>
        <p className="text-sm font-semibold uppercase tracking-widest text-bronze">{atual.categoria}</p>
        <h3 className="font-display text-2xl leading-tight">{atual.titulo}</h3>
        <CorpoArtigo texto={atual.corpo} />
        <p className="text-sm text-ledger-muted">Revisado em {new Date(atual.revisado_em + "T12:00:00").toLocaleDateString("pt-BR")}</p>
      </div>
    );
  }

  const lista = filtrarAjuda(artigos, busca);
  const daTela = tela && !busca ? lista.filter((a) => a.tela === tela) : [];
  const grupos = new Map<string, ArtigoAjuda[]>();
  for (const a of lista) grupos.set(a.categoria, [...(grupos.get(a.categoria) ?? []), a]);

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-base font-medium">Buscar ajuda</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ledger-muted" aria-hidden />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: senha, foto, maleta"
            className="admin-input min-h-12 w-full pl-10 text-base" />
        </span>
      </label>
      {q.isLoading && <p className="text-base text-ledger-muted">Carregando ajuda…</p>}
      {q.isError && <p className="text-base">Não foi possível carregar a ajuda agora. Verifique sua internet e tente de novo.</p>}
      {!q.isLoading && !q.isError && lista.length === 0 && (
        <p className="text-base">Nada encontrado para “{busca}”. Tente outra palavra, como “foto” ou “senha”.</p>
      )}
      {daTela.length > 0 && <Grupo titulo="Sobre esta tela" itens={daTela} abrir={setAberto} destaque />}
      {[...grupos].map(([cat, itens]) => <Grupo key={cat} titulo={cat} itens={itens} abrir={setAberto} />)}
    </div>
  );
}

function Grupo({ titulo, itens, abrir, destaque }: { titulo: string; itens: ArtigoAjuda[]; abrir: (s: string) => void; destaque?: boolean }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-bronze">{titulo}</h3>
      <ul className="space-y-2">
        {itens.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => abrir(a.slug)}
              className={`w-full rounded-xl border p-4 text-left ${destaque ? "border-bronze bg-surface" : "border-line-soft bg-surface"}`}>
              <span className="block text-base font-semibold">{a.titulo}</span>
              {a.resumo && <span className="mt-1 block text-[0.95rem] text-ledger-muted">{a.resumo}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Botão “Ajuda” que abre a central por cima da tela, sem perder o que está preenchido. */
export function BotaoAjuda({ tela, className = "" }: { tela?: string | undefined; className?: string }) {
  const [aberta, setAberta] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={`admin-btn min-h-12 text-base ${className}`}>
        <CircleHelp className="size-5" aria-hidden /> Ajuda
      </button>
      <Sheet open={aberta} onOpenChange={setAberta}>
        <SheetContent side="right" className="w-full overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle className="font-display text-2xl">Central de Ajuda</SheetTitle>
            <SheetDescription className="text-base">Ao fechar, você volta exatamente para onde estava.</SheetDescription>
          </SheetHeader>
          <CentralAjuda tela={tela} />
        </SheetContent>
      </Sheet>
    </>
  );
}

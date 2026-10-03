import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, MessageCircle, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";

type Dados = {
  codigo: string | null;
  ativo: boolean;
  aprovadas: number;
  faixa: { titulo: string; percentual: number } | null;
  proxima: { titulo: string; percentual: number; faltam: number } | null;
  faixas: { min: number; percentual: number; titulo: string }[];
  indicadas: { nome: string; cidade: string; uf: string; em: string; situacao: "aprovada" | "em_analise" | "nao_seguiu" }[];
  comissoes: {
    id: string; em: string; indicada: string; venda_cents: number; pecas: number; percentual: number; faixa: string;
    comissao_cents: number; status: string; itens: { produto: string; qtd: number; preco_cents: number; total_cents: number }[];
  }[];
};

const SIT = {
  aprovada: { r: "Aprovada", c: "bg-primary/10 text-primary" },
  em_analise: { r: "Em análise", c: "bg-muted text-muted-foreground" },
  nao_seguiu: { r: "Não seguiu", c: "bg-muted text-muted-foreground" },
} as const;

export function Indicacoes() {
  const q = useQuery({
    queryKey: ["consultora", "indicacoes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("minhas_indicacoes" as never);
      if (error) throw error;
      return data as unknown as Dados;
    },
  });
  if (q.isLoading) return <p className="text-base text-muted-foreground">Carregando…</p>;
  if (q.error || !q.data) return <p className="text-base text-destructive">{traduzir(q.error)}</p>;
  const d = q.data;
  const link = typeof window !== "undefined" && d.codigo ? `${window.location.origin}/seja-lardan?indica=${d.codigo}#candidatura` : "";
  const texto = `Oi! Sou Consultora Lardan e acho que você vai amar. Conheça e faça sua candidatura: ${link}`;
  const total = d.comissoes.filter((c) => c.status !== "cancelada").reduce((s, c) => s + c.comissao_cents, 0);

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-[0.98rem] text-muted-foreground">Seu link de indicação (é só um, e é seu para sempre)</p>
        <p className="mt-2 break-all rounded-xl bg-muted px-4 py-3 text-[0.95rem]">{link || "Link indisponível"}</p>
        {!d.ativo && <p className="mt-2 text-sm text-destructive">O programa de indicação está pausado pela Lardan.</p>}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button type="button" className="btn-app-principal" disabled={!link} onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}>
            <Copy className="size-5" aria-hidden /> Copiar link
          </button>
          <a className="admin-btn min-h-12 justify-center text-base" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
            <MessageCircle className="size-5" aria-hidden /> Enviar no WhatsApp
          </a>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button type="button" className="admin-btn min-h-12 justify-center text-base" onClick={() => void navigator.share({ title: "Seja Lardan", text: texto, url: link }).catch(() => undefined)}>
              <Share2 className="size-5" aria-hidden /> Compartilhar
            </button>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Indicadas aprovadas</p><p className="mt-1 text-3xl font-semibold num">{d.aprovadas}</p></div>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Sua faixa</p><p className="mt-1 text-2xl font-semibold">{d.faixa ? `${d.faixa.titulo} · ${Number(d.faixa.percentual)}%` : "Ainda sem faixa"}</p></div>
        <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Comissões apuradas</p><p className="mt-1 text-2xl font-semibold num">{brl(total)}</p></div>
      </section>
      {d.proxima && <p className="text-[0.98rem] text-muted-foreground">Faltam <strong className="text-foreground">{d.proxima.faltam}</strong> aprovadas para virar <strong className="text-foreground">{d.proxima.titulo}</strong> ({Number(d.proxima.percentual)}%).</p>}
      <p className="text-sm text-muted-foreground">Regras: {d.faixas.map((f) => `${f.min}+ aprovadas = ${Number(f.percentual)}% (${f.titulo})`).join(" · ")}. A comissão é calculada sobre as peças realmente vendidas, quando a maleta da indicada é encerrada.</p>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-[1.15rem] font-semibold"><Users className="size-5 text-primary" aria-hidden /> Minhas indicadas</h2>
        {d.indicadas.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-base text-muted-foreground">Ninguém se candidatou pelo seu link ainda.</p> : (
          <ul className="space-y-2">{d.indicadas.map((i, n) => (
            <li key={n} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="min-w-0"><span className="block text-[1.05rem] font-semibold">{i.nome}</span><span className="block text-sm text-muted-foreground">{i.cidade}/{i.uf} · {new Date(i.em).toLocaleDateString("pt-BR")}</span></span>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${SIT[i.situacao].c}`}>{SIT[i.situacao].r}</span>
            </li>))}</ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-[1.15rem] font-semibold">Comissões por maleta</h2>
        {d.comissoes.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-base text-muted-foreground">Nenhuma maleta de indicada foi encerrada ainda.</p> : (
          <ul className="space-y-2">{d.comissoes.map((c) => (
            <li key={c.id} className="rounded-2xl border border-border bg-card p-4">
              <details>
                <summary className="flex cursor-pointer items-center justify-between gap-3">
                  <span><span className="block text-[1.05rem] font-semibold">{c.indicada}</span><span className="block text-sm text-muted-foreground">{new Date(c.em).toLocaleDateString("pt-BR")} · vendeu {brl(c.venda_cents)} · {Number(c.percentual)}%</span></span>
                  <span className="text-lg font-semibold num">{brl(c.comissao_cents)}</span>
                </summary>
                <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">{c.itens.map((it, k) => (
                  <li key={k} className="flex justify-between gap-2"><span>{it.qtd}× {it.produto}</span><span className="num">{brl(it.total_cents)}</span></li>))}</ul>
              </details>
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}

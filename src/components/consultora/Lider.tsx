/**
 * 0159 — Caminho para líder (critérios configuráveis no admin), pedido de aprovação e "Minha equipe"
 * (liberada só para líder aprovada pela Lardan). Também o cartão "Indique e seja líder" do Início.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Crown, MessageCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";

async function rpc<T>(fn: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never);
  if (error) throw error;
  return data as T;
}
type Caminho = { indicadas_ativas: number; indicadas_ativas_min: number; venda_ciclo_cents: number; venda_ciclo_min_cents: number; cumpre: boolean; status: string | null };
type Membro = { nome: string; status: string; ativa: boolean; maleta: { acerto: string | null; vendido_cents: number } | null };

export const useCaminhoLider = () => useQuery({ queryKey: ["consultora", "lider"], queryFn: () => rpc<Caminho>("meu_caminho_lider"), retry: false });

function Barra({ valor, total }: { valor: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((valor / total) * 100)) : 100;
  return <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>;
}

export function CaminhoLider() {
  const qc = useQueryClient();
  const q = useCaminhoLider();
  const pedir = useMutation({
    mutationFn: () => rpc<string>("lider_solicitar"),
    onSuccess: () => { toast.success("Pedido enviado. A Lardan vai avaliar e te avisa."); void qc.invalidateQueries({ queryKey: ["consultora", "lider"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const c = q.data;
  if (!c) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-[1.15rem] font-semibold"><Crown className="size-5 text-primary" aria-hidden /> Caminho para líder</h2>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[0.98rem]"><span>Indicadas ativas</span><strong className="num">{c.indicadas_ativas} de {c.indicadas_ativas_min}</strong></div>
        <Barra valor={c.indicadas_ativas} total={c.indicadas_ativas_min} />
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[0.98rem]"><span>Sua venda no último ciclo</span><strong className="num">{brl(c.venda_ciclo_cents)} de {brl(c.venda_ciclo_min_cents)}</strong></div>
        <Barra valor={c.venda_ciclo_cents} total={c.venda_ciclo_min_cents} />
      </div>
      {c.status === "aprovado" ? <p className="text-[0.98rem] font-semibold text-primary">Você é Líder Lardan. Sua equipe está logo abaixo.</p>
        : c.status === "solicitado" ? <p className="text-[0.98rem] text-muted-foreground">Pedido enviado. A Lardan está avaliando.</p>
        : c.cumpre ? <button type="button" className="btn-app-principal w-full" disabled={pedir.isPending} onClick={() => pedir.mutate()}>Pedir para virar líder</button>
        : <p className="text-sm text-muted-foreground">Indicada ativa é quem tem cadastro ativo e recebeu maleta nos últimos 90 dias.</p>}
    </section>
  );
}

export function MinhaEquipe() {
  const lider = useCaminhoLider();
  const q = useQuery({ queryKey: ["consultora", "equipe"], queryFn: () => rpc<Membro[]>("minha_equipe"), enabled: lider.data?.status === "aprovado", retry: false });
  if (lider.data?.status !== "aprovado") return null;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <h2 className="text-[1.15rem] font-semibold">Minha equipe</h2>
      {q.isLoading && <p className="text-muted-foreground">Carregando…</p>}
      {q.data?.length === 0 && <p className="text-muted-foreground">Sua equipe aparece aqui quando suas indicadas virarem consultoras.</p>}
      <ul className="divide-y divide-border">
        {q.data?.map((m, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-3">
            <span><span className="block text-[1.02rem] font-semibold">{m.nome}</span>
              <span className="block text-sm text-muted-foreground">{m.maleta ? `Maleta na rua · vendeu ${brl(m.maleta.vendido_cents)}${m.maleta.acerto ? ` · acerto ${m.maleta.acerto.split("-").reverse().join("/")}` : ""}` : "Sem maleta agora"}</span></span>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${m.ativa ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>{m.ativa ? "Ativa" : "Parada"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cartão do Início: link próprio, copiar e WhatsApp, e a barra do caminho para líder. */
export function CartaoIndique({ abrir }: { abrir: () => void }) {
  const ind = useQuery({ queryKey: ["consultora", "indicacoes"], queryFn: () => rpc<{ codigo: string | null; ativo: boolean; indicadas: unknown[] }>("minhas_indicacoes") });
  const lider = useCaminhoLider();
  const d = ind.data;
  if (!d?.codigo || !d.ativo) return null;
  const link = `${window.location.origin}/indicacao/${d.codigo}`;
  const texto = `Oi! Sou Consultora Lardan e acho que você vai amar. Conheça e faça sua candidatura: ${link}`;
  const c = lider.data;
  return (
    <section className="space-y-3 rounded-3xl border border-primary/40 bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-2xl"><UserPlus className="size-5 text-primary" aria-hidden /> Indique e seja líder</h2>
      <p className="text-[0.98rem] text-muted-foreground">Quem se cadastrar pelo seu link entra na sua equipe.</p>
      <p className="break-all rounded-xl border border-border px-3 py-2.5 text-[0.95rem]">{link.replace(/^https?:\/\//, "")}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="admin-btn min-h-12 justify-center text-base" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}><Copy className="size-5" aria-hidden /> Copiar</button>
        <a className="btn-app-principal justify-center" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-5" aria-hidden /> WhatsApp</a>
      </div>
      {c && c.status !== "aprovado" && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[0.95rem]"><span>Caminho para líder</span><span className="text-primary">{c.indicadas_ativas} de {c.indicadas_ativas_min} indicadas ativas</span></div>
          <Barra valor={c.indicadas_ativas} total={c.indicadas_ativas_min} />
        </div>
      )}
      <button type="button" className="text-[0.95rem] text-primary underline" onClick={abrir}>Ver minhas indicadas ({d.indicadas.length})</button>
    </section>
  );
}

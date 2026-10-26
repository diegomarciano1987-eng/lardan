/**
 * 0159 — cartões do Início: Liga Lardan (nível e quanto falta) e Acerto da maleta (data, valor, vendeu X de Y).
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/maletas";
import type { Inicio } from "@/lib/consultora";

type Liga = { nivel: string | null; proximo: string | null; ciclos: number | null; ciclos_min: number | null; faltam: number; venda_min_cents: number | null };

export function CartaoLiga() {
  const q = useQuery({ queryKey: ["consultora", "liga"], retry: false, queryFn: async () => {
    const { data, error } = await supabase.rpc("minha_liga" as never); if (error) throw error; return data as unknown as Liga;
  } });
  const l = q.data;
  if (!l?.nivel) return null;
  const pct = l.ciclos_min ? Math.min(100, Math.round(((l.ciclos ?? 0) / l.ciclos_min) * 100)) : 100;
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground"><Star className="size-4 text-primary" aria-hidden /> Liga Lardan</p>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="font-display text-3xl text-primary">Nível {l.nivel}</p>
        {l.proximo && <p className="text-[0.95rem] text-muted-foreground">próximo: {l.proximo}</p>}
      </div>
      {l.proximo && (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
          <p className="mt-2 text-[0.95rem] text-muted-foreground">
            {l.faltam > 0 ? `Faltam ${l.faltam} ${l.faltam === 1 ? "ciclo" : "ciclos"} com venda acima de ${brl(l.venda_min_cents ?? 0)} para subir de nível` : "Você já cumpre o próximo nível: ele aparece no próximo acerto."}
          </p>
        </>
      )}
    </section>
  );
}

export function CartaoAcerto({ d, ir }: { d: Inicio; ir: (aba: "maleta" | "financeiro") => void }) {
  const a = d.acerto;
  if (!a) return null;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dias = a.data ? Math.round((new Date(a.data + "T12:00:00").getTime() - new Date(hoje + "T12:00:00").getTime()) / 86400000) : null;
  const pct = a.pecas_total ? Math.round((a.pecas_vendidas / a.pecas_total) * 100) : 0;
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Acerto da maleta</p>
        {dias != null && <span className="rounded-full bg-muted px-3 py-0.5 text-sm">{dias >= 0 ? `faltam ${dias} dias` : `atrasado ${-dias} dias`}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div><p className="text-sm text-muted-foreground">Data do acerto</p><p className="text-2xl font-semibold tabular-nums">{a.data ? a.data.split("-").reverse().join("/") : "—"}</p></div>
        <div className="text-right"><p className="text-sm text-muted-foreground">Valor a acertar</p><p className="text-2xl font-semibold tabular-nums">{a.valor_cents != null ? brl(a.valor_cents) : "—"}</p></div>
      </div>
      <div className="mt-3 flex justify-between text-[0.95rem]"><span>Vendeu {a.pecas_vendidas} de {a.pecas_total} peças</span><span>{pct}%</span></div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      <p className={`mt-3 flex items-center gap-2 text-[0.95rem] ${d.debitos_vencidos_cents > 0 ? "text-destructive" : "text-success"}`}>
        {d.debitos_vencidos_cents > 0 ? `Débito vencido: ${brl(d.debitos_vencidos_cents)}` : <><Check className="size-4" aria-hidden /> Sem débitos vencidos</>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="admin-btn min-h-12 justify-center text-base" onClick={() => ir("maleta")}>Ver maleta</button>
        <button type="button" className="admin-btn min-h-12 justify-center text-base" onClick={() => ir("financeiro")}>Meu financeiro</button>
      </div>
    </section>
  );
}

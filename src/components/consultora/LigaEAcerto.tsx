/**
 * 0159 — cartões do Início: Liga Lardan (nível e quanto falta) e Acerto da maleta (data, valor, vendeu X de Y).
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Star, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ligaQuery } from "@/lib/consultora-queries";
import { brl } from "@/lib/maletas";
import type { Inicio } from "@/lib/consultora";

export function CartaoLiga({ compacto = false }: { compacto?: boolean }) {
  const q = useQuery(ligaQuery());
  const [expandida, setExpandida] = React.useState(false);
  const detalhesId = React.useId();
  React.useEffect(() => {
    try { setExpandida(sessionStorage.getItem("lardan-liga-expandida") === "1"); } catch { /* optional preference */ }
  }, []);
  const l = q.data;
  if (!l?.nivel) return null;
  const pct = l.ciclos_min ? Math.min(100, Math.round(((l.ciclos ?? 0) / l.ciclos_min) * 100)) : 100;
  if (compacto) return (
    <section aria-label="Liga LARDAN" className="consultora-liga-compacta rounded-lg border border-border bg-card px-4 py-2">
      <div className="flex min-h-11 items-center gap-3">
        <Star className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1"><p className="text-base font-semibold leading-snug">Liga LARDAN <span className="text-muted-foreground">· {l.nivel}</span></p></div>
        <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={expandida ? "Recolher Liga LARDAN" : "Expandir Liga LARDAN"} aria-expanded={expandida} aria-controls={detalhesId} onClick={() => {
          setExpandida(!expandida);
          try { sessionStorage.setItem("lardan-liga-expandida", expandida ? "0" : "1"); } catch { /* optional preference */ }
        }}>{expandida ? <ChevronUp /> : <ChevronDown />}</Button>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Progresso da Liga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
      {expandida && <div id={detalhesId} className="border-t border-border pt-3 mt-3 text-base leading-relaxed">
        {l.proximo ? <><p className="font-semibold">Próximo nível: {l.proximo}</p><p className="mt-1 text-muted-foreground">{l.faltam > 0 ? `Faltam ${l.faltam} ciclos com venda acima de ${brl(l.venda_min_cents ?? 0)}.` : "Você já cumpre o próximo nível: ele aparece no próximo acerto."}</p></> : <p className="font-semibold">Nível {l.nivel}</p>}
      </div>}
    </section>
  );
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
        <div className="text-right"><p className="text-sm text-muted-foreground">{a.valor_cents != null && a.valor_cents < 0 ? "A Lardan te deve" : "Valor a acertar"}</p><p className="text-2xl font-semibold tabular-nums">{a.valor_cents != null ? brl(Math.abs(a.valor_cents)) : "—"}</p></div>
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

import * as React from "react";
import { ClientOnly } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { DateRangeField } from "@/components/premium/DateRangeField";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/representante";
import type { GrupoCep } from "@/components/admin/rede/MapaCidadeLeaflet";

const MapaCidadeLeaflet = React.lazy(() => import("@/components/admin/rede/MapaCidadeLeaflet"));

type Linha = { nome: string; code: string; valor: number; pecas: number; maletas: number };
type Ranking = { consultoras: number; valor_cents: number; pecas: number; top_valor: Linha[]; pior_valor: Linha[]; top_pecas: Linha[]; pior_pecas: Linha[] };
type Mapa = { sem_local: number; cidades: { chave: string; city: string; uf: string; lat: number; lng: number; total: number; ativas: number; pessoas?: { id: string; nome: string }[] }[] };

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function PainelRepresentante({ rep }: { rep: string }) {
  const hoje = new Date();
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>({ from: new Date(hoje.getFullYear(), hoje.getMonth(), 1), to: hoje });
  const [criterio, setCriterio] = React.useState<"valor" | "pecas">("valor");
  const de = periodo?.from ? iso(periodo.from) : "2000-01-01";
  const ate = periodo?.to ? iso(periodo.to) : periodo?.from ? iso(periodo.from) : iso(hoje);
  const rk = useQuery({ queryKey: ["rep", rep, "ranking", de, ate], queryFn: () => chamar<Ranking>("rep_portal_ranking", { _rep: rep, _de: de, _ate: ate }), placeholderData: keepPreviousData });
  const mp = useQuery({ queryKey: ["rep", rep, "mapa"], queryFn: () => chamar<Mapa>("rep_portal_mapa", { _rep: rep }) });
  const grupos: GrupoCep[] = (mp.data?.cidades ?? []).map((c) => ({ chave: c.chave, lat: c.lat, lng: c.lng, cep: null, total: c.total, ativas: c.ativas, aproximado: false }));
  const [sel, setSel] = React.useState<string | null>(null);
  const cidadeSel = mp.data?.cidades.find((c) => c.chave === sel);
  const r = rk.data;

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ranking das consultoras</h2>
            <p className="text-sm text-muted-foreground">Vendas reais das maletas acertadas no período.</p>
          </div>
          <div className="w-full sm:w-72"><DateRangeField value={periodo} onChange={setPeriodo} /></div>
        </div>
        <div className="flex gap-2">
          {(["valor", "pecas"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setCriterio(k)}
              className={`rounded-full border px-3 py-1.5 text-sm ${criterio === k ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`}>
              {k === "valor" ? "Por valor (R$)" : "Por peças"}
            </button>
          ))}
        </div>
        {rk.error && <p className="text-sm text-destructive">{(rk.error as Error).message}</p>}
        {r && r.consultoras === 0 ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Sem dados: nenhuma maleta da sua carteira foi acertada neste período.</p>
        ) : r ? (
          <>
            <p className="text-sm text-muted-foreground">{r.consultoras} consultoras · {brl(r.valor_cents)} · {r.pecas} peças vendidas</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Lista titulo="Top 10" linhas={criterio === "valor" ? r.top_valor : r.top_pecas} criterio={criterio} />
              <Lista titulo="Precisam de atenção" linhas={criterio === "valor" ? r.pior_valor : r.pior_pecas} criterio={criterio} />
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">Carregando…</p>}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5 md:p-6">
        <h2 className="text-lg font-semibold">Mapa da carteira</h2>
        {mp.error && <p className="text-sm text-destructive">{(mp.error as Error).message}</p>}
        {mp.data && (
          <p className="text-sm text-muted-foreground">
            {mp.data.cidades.length} cidades · {mp.data.cidades.reduce((s, c) => s + c.total, 0)} consultoras no mapa
            {mp.data.sem_local > 0 ? ` · ${mp.data.sem_local} sem endereço localizado` : ""}
          </p>
        )}
        {grupos.length > 0 ? (
          <ClientOnly fallback={<div className="h-[420px] rounded-xl bg-muted" />}>
            <React.Suspense fallback={<div className="h-[420px] rounded-xl bg-muted" />}>
              <div className="[&>div]:h-[420px] md:[&>div]:h-[560px]">
                <MapaCidadeLeaflet grupos={grupos} contorno={null} selecionado={sel} onSelecionar={setSel} />
              </div>
            </React.Suspense>
          </ClientOnly>
        ) : mp.data ? <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Sem dados: nenhuma consultora com endereço localizado.</p> : null}
        {cidadeSel && <p className="text-sm"><b>{cidadeSel.city}/{cidadeSel.uf}</b> · {cidadeSel.total} consultoras · {cidadeSel.ativas} ativas</p>}
      </section>
    </div>
  );
}

function Lista({ titulo, linhas, criterio }: { titulo: string; linhas: Linha[]; criterio: "valor" | "pecas" }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="mb-2 text-sm font-semibold">{titulo}</p>
      <ol className="space-y-2">
        {linhas.map((l, i) => (
          <li key={l.code + i} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>{l.nome}</span>
            <span className="shrink-0 font-semibold tabular-nums">{criterio === "valor" ? brl(l.valor) : `${l.pecas} peças`}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

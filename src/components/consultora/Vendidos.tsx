/**
 * 0211 — "Vendidos": tudo o que a consultora vendeu no período, com o total e as formas
 * (Pix/cartão/boleto pela Lardan, dinheiro, receber depois, marcada como feita) e o que foi marcado na maleta sem pedido.
 * Números só do banco (consultora_vendidos).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, CalendarClock, CheckCircle2, CreditCard, FileText, LoaderCircle, PackageCheck, QrCode, ShoppingBag, Store } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, traduzir } from "@/lib/maletas";

type Forma = "pix" | "cartao" | "boleto" | "dinheiro" | "receber_depois" | "marcada_feita" | "sem_forma";
interface Dados {
  de: string; ate: string;
  resumo: { vendas: number; valor_cents: number; pecas: number; pago_lardan_cents: number; dinheiro_cents: number; a_receber_cents: number; vitrine_cents: number };
  formas: { forma: Forma; vendas: number; valor_cents: number }[];
  vendas: { order_id: string; codigo: string; data: string; cliente: string; valor_cents: number; pecas: number; forma: Forma; canal: string; pago: boolean; entregue: boolean; situacao: string }[];
  maleta_sem_pedido: { valor_cents: number; pecas: number };
}

export const FORMA_VENDA: Record<Forma, { rotulo: string; icone: typeof QrCode }> = {
  pix: { rotulo: "Pix (Lardan)", icone: QrCode },
  cartao: { rotulo: "Cartão (Lardan)", icone: CreditCard },
  boleto: { rotulo: "Boleto/link (Lardan)", icone: FileText },
  dinheiro: { rotulo: "Dinheiro", icone: Banknote },
  receber_depois: { rotulo: "Receber depois (fiado)", icone: CalendarClock },
  marcada_feita: { rotulo: "Marcada como feita", icone: CheckCircle2 },
  sem_forma: { rotulo: "Sem forma definida", icone: ShoppingBag },
};

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function periodo(p: "mes" | "anterior" | "7d" | "ano") {
  const hoje = new Date();
  if (p === "7d") { const d = new Date(hoje); d.setDate(d.getDate() - 6); return { de: iso(d), ate: iso(hoje) }; }
  if (p === "anterior") return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)) };
  if (p === "ano") return { de: iso(new Date(hoje.getFullYear(), 0, 1)), ate: iso(hoje) };
  return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: iso(hoje) };
}
const ROTULO_PERIODO = { mes: "Este mês", anterior: "Mês passado", "7d": "7 dias", ano: "Este ano" } as const;

export function Vendidos() {
  const [p, setP] = React.useState<keyof typeof ROTULO_PERIODO>("mes");
  const { de, ate } = periodo(p);
  const q = useQuery({
    queryKey: ["consultora", "vendidos", de, ate],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_vendidos" as never, { _de: de, _ate: ate } as never);
      if (error) throw error;
      return data as unknown as Dados;
    },
  });
  const d = q.data;
  return (
    <div className="max-w-3xl space-y-6">
      <div role="tablist" aria-label="Período" className="grid grid-cols-4 gap-2">
        {(Object.keys(ROTULO_PERIODO) as (keyof typeof ROTULO_PERIODO)[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={p === k} onClick={() => setP(k)}
            className={`min-h-12 rounded-2xl border px-2 text-[0.95rem] font-medium ${p === k ? "border-primary bg-primary/10 text-primary" : "border-border bg-card"}`}>{ROTULO_PERIODO[k]}</button>
        ))}
      </div>
      {q.isLoading && <p role="status" className="flex items-center gap-3 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /> Somando suas vendas…</p>}
      {q.isError && <p role="alert">{traduzir(q.error)}</p>}
      {d && (
        <>
          <section className="rounded-3xl border border-border bg-card p-5">
            <span className="block text-base text-muted-foreground">Total vendido · {d.resumo.vendas} {d.resumo.vendas === 1 ? "venda" : "vendas"} · {d.resumo.pecas} peças</span>
            <strong className="num mt-1 block text-4xl font-semibold">{brl(Number(d.resumo.valor_cents))}</strong>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini rotulo="Pago à Lardan" valor={d.resumo.pago_lardan_cents} dica="abate no acerto" />
              <Mini rotulo="Em dinheiro" valor={d.resumo.dinheiro_cents} dica="ficou com você" />
              <Mini rotulo="A receber" valor={d.resumo.a_receber_cents} dica="clientes ainda vão pagar" />
              <Mini rotulo="Pela vitrine" valor={d.resumo.vitrine_cents} dica="compras no seu link" icone={Store} />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[1.15rem] font-semibold">Por forma de pagamento</h2>
            {d.formas.length === 0 ? <p className="text-muted-foreground">Nenhuma venda neste período.</p> : (
              <ul className="space-y-2">{d.formas.map((f) => {
                const F = FORMA_VENDA[f.forma] ?? FORMA_VENDA.sem_forma; const pct = d.resumo.valor_cents ? (Number(f.valor_cents) / Number(d.resumo.valor_cents)) * 100 : 0;
                return (
                  <li key={f.forma} className="rounded-2xl border border-border bg-card p-4">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[1.02rem] font-semibold"><F.icone className="size-5 text-primary" aria-hidden />{F.rotulo}</span>
                      <strong className="num text-lg">{brl(Number(f.valor_cents))}</strong>
                    </span>
                    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 2)}%` }} /></span>
                    <span className="mt-1 block text-sm text-muted-foreground">{f.vendas} {f.vendas === 1 ? "venda" : "vendas"} · {pct.toFixed(0)}%</span>
                  </li>
                );
              })}</ul>
            )}
          </section>

          {Number(d.maleta_sem_pedido.pecas) > 0 && (
            <section className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4">
              <PackageCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span><strong className="block text-[1.02rem]">Marcadas como vendidas na maleta: {d.maleta_sem_pedido.pecas} peças · {brl(Number(d.maleta_sem_pedido.valor_cents))}</strong>
                <span className="block text-sm text-muted-foreground">Peças que você marcou na pré-baixa sem pedido no app. Entram no acerto da maleta.</span></span>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-[1.15rem] font-semibold">Vendas</h2>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">{d.vendas.map((v) => {
              const F = FORMA_VENDA[v.forma] ?? FORMA_VENDA.sem_forma;
              return (
                <li key={v.order_id} className="flex items-center justify-between gap-3 p-4">
                  <span className="min-w-0">
                    <span className="block truncate text-[1.02rem] font-semibold">{v.cliente}</span>
                    <span className="block text-sm text-muted-foreground">{new Date(v.data).toLocaleDateString("pt-BR")} · {v.codigo} · {F.rotulo}{v.canal === "vitrine" ? " · vitrine" : ""}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-semibold">{brl(Number(v.valor_cents))}</span>
                    <span className={`block text-xs ${v.pago ? "text-success" : "text-muted-foreground"}`}>{v.pago ? (v.entregue ? "pago · entregue" : "pago") : v.forma === "marcada_feita" ? "concluída" : "aguardando"}</span>
                  </span>
                </li>
              );
            })}</ul>
          </section>
        </>
      )}
    </div>
  );
}

function Mini({ rotulo, valor, dica, icone: I }: { rotulo: string; valor: number; dica: string; icone?: typeof Store }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <span className="flex items-center gap-1 text-sm text-muted-foreground">{I && <I className="size-4" aria-hidden />}{rotulo}</span>
      <strong className="num block text-lg">{brl(Number(valor))}</strong>
      <span className="block text-xs text-muted-foreground">{dica}</span>
    </div>
  );
}

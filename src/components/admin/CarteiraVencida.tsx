/**
 * 0408 — Carteira vencida: um número só para Início, Financeiro e Cobrança (painel_carteira_vencida).
 * Mesma base da Cobrança: todas as parcelas a receber em aberto, vencidas antes de hoje, de qualquer época
 * (inclui fiado e dívidas antigas). O card "Vencido a receber no período" do Pulso continua sendo só o recorte do período.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { formatBRLFromCents, formatInt } from "@/components/admin/ui";

export type CarteiraVencidaDados = {
  data: string; vencido_cents: number; a_vencer_cents: number; carteira_cents: number;
  devedoras: number; devedoras_vencidas: number; inadimplencia_pct: number;
  faixas: { faixa: string; rotulo: string; cents: number; parcelas: number }[];
};

export const carteiraVencidaQuery = {
  queryKey: ["carteira-vencida"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("painel_carteira_vencida" as never);
    if (error) throw error;
    return data as unknown as CarteiraVencidaDados;
  },
  staleTime: 60_000,
};

const DICA = "Carteira vencida = soma do que falta receber de todas as parcelas já vencidas, de qualquer época (inclui fiado e dívidas antigas). É o mesmo número da Cobrança. Inadimplência = vencido ÷ tudo que está em aberto (vencido + a vencer).";

/** Bloco completo (Início e Financeiro). `compacto` mostra só as faixas (Cobrança). */
export function CarteiraVencida({ compacto = false }: { compacto?: boolean }) {
  const q = useQuery(carteiraVencidaQuery);
  if (q.isError) return null; // sem permissão de financeiro nem de cobrança: o bloco simplesmente não aparece
  const d = q.data;
  const total = Number(d?.vencido_cents ?? 0);

  const faixas = (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        {(d?.faixas ?? []).map((f, i) => (
          <div key={f.faixa} style={{ width: `${total ? (Number(f.cents) / total) * 100 : 0}%`, opacity: 1 - i * 0.2 }} className="h-full bg-danger" />
        ))}
      </div>
      <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {(d?.faixas ?? []).map((f) => (
          <li key={f.faixa} className="flex justify-between gap-2">
            <span className="text-ledger-muted">{f.rotulo}</span>
            <span className="num font-semibold text-ledger-text">
              {formatBRLFromCents(Number(f.cents))}
              <span className="ml-1 font-normal text-ledger-muted">{total ? `${Math.round((Number(f.cents) / total) * 100)}%` : "—"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (compacto) {
    return (
      <section className="rounded-xl border border-border bg-card p-4" title={DICA}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>Idade da dívida vencida</span>
          <span>Inadimplência <b className="num text-foreground">{d ? `${String(d.inadimplencia_pct).replace(".", ",")}%` : "…"}</b> da carteira em aberto</span>
        </div>
        {faixas}
      </section>
    );
  }

  return (
    <section className="ledger-panel space-y-4 p-5" aria-label="Carteira vencida">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ledger-eyebrow" title={DICA}>Carteira vencida · todas as épocas ⓘ</p>
          <p className="num mt-1 text-3xl font-semibold text-danger">{d ? formatBRLFromCents(total) : "—"}</p>
          <p className="mt-1 text-xs text-ledger-muted">
            {d ? `${formatInt(d.devedoras_vencidas)} pessoas com parcela vencida · ${formatInt(d.devedoras)} devedoras na Cobrança` : "Carregando…"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-right">
          <div>
            <p className="text-xs text-ledger-muted" title="Vencido ÷ (vencido + a vencer)">Inadimplência</p>
            <p className="num text-xl font-semibold text-ledger-text">{d ? `${String(d.inadimplencia_pct).replace(".", ",")}%` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-ledger-muted">A vencer</p>
            <p className="num text-xl font-semibold text-ledger-text">{d ? formatBRLFromCents(Number(d.a_vencer_cents)) : "—"}</p>
          </div>
        </div>
      </div>
      {faixas}
      <p className="text-xs text-ledger-muted">
        O card "Vencido a receber no período" acima mostra só o que venceu dentro do período escolhido.{" "}
        <Link to="/admin/cobranca" className="font-semibold text-bronze underline-offset-4 hover:underline">Abrir a Cobrança</Link>
      </p>
    </section>
  );
}

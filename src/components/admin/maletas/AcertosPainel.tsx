/**
 * 0158 — Acertos pelo app (pré-baixa): quem fechou, quem pagou, o que falta conferir e as pendências,
 * mais os indicadores (acertos sem divergência, tempo médio até encerrar, pré-baixas no prazo).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Panel } from "@/components/admin/ui";
import { indicadoresPreBaixa, painelPreBaixas, ROTULO_SITUACAO, type SituacaoPreBaixa } from "@/lib/pre-baixa";

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const FILTROS: (SituacaoPreBaixa | "")[] = ["", "aberta", "aguardando_pagamento", "aguardando_conferencia", "pendencia", "encerrada"];

export function AcertosPainel() {
  const [filtro, setFiltro] = React.useState<SituacaoPreBaixa | "">("aguardando_conferencia");
  const lista = useQuery({ queryKey: ["maletas", "pre-baixas", filtro], queryFn: () => painelPreBaixas(filtro || undefined), retry: false });
  const ind = useQuery({ queryKey: ["maletas", "pre-baixas", "indicadores"], queryFn: indicadoresPreBaixa, retry: false });
  if (lista.isError) return null;
  const g = ind.data?.geral;
  return (
    <Panel title="Acertos pelo app (pré-baixa)">
      <div className="space-y-4 text-sm">
        {g && (
          <div className="grid gap-3 md:grid-cols-4">
            {[["Acertos conferidos (180 dias)", String(g.conferidos)], ["Sem divergência", g.sem_divergencia_pct != null ? `${g.sem_divergencia_pct}%` : "—"],
              ["Pré-baixa → encerramento", g.horas_media_pre_baixa_ate_encerrar != null ? `${g.horas_media_pre_baixa_ate_encerrar} h em média` : "—"],
              ["Pré-baixas no prazo", g.no_prazo_pct != null ? `${g.no_prazo_pct}%` : "—"]].map(([t, v]) => (
              <div key={t} className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">{t}</p><p className="text-lg font-semibold">{v}</p></div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button key={f || "todas"} type="button" onClick={() => setFiltro(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${filtro === f ? "border-champagne bg-champagne-soft" : "border-line text-ledger-muted"}`}>
              {f ? ROTULO_SITUACAO[f] : "Todas"}
            </button>
          ))}
        </div>
        {(lista.data ?? []).length === 0 ? <p className="text-ledger-muted">Nenhum acerto nesta situação.</p> : (
          <div className="max-h-96 overflow-auto rounded-xl border border-line-soft">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface text-left text-ledger-muted"><tr>
                <th className="px-3 py-2">Maleta</th><th className="px-3 py-2">Consultora</th><th className="px-3 py-2">Remessa</th><th className="px-3 py-2">Prazo</th>
                <th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">A pagar</th></tr></thead>
              <tbody>{lista.data!.map((p) => (
                <tr key={p.cycle_id} className="border-t border-line-soft">
                  <td className="px-3 py-1.5"><Link to="/admin/maletas/$id" params={{ id: p.cycle_id }} className="admin-link">{p.maleta}</Link></td>
                  <td className="px-3 py-1.5">{p.consultora}</td><td className="px-3 py-1.5">{p.remessa ?? "—"}</td><td className="px-3 py-1.5">{dataBR(p.prazo)}</td>
                  <td className="px-3 py-1.5">{ROTULO_SITUACAO[p.situacao]}{p.pendencia ? <span className="block text-destructive">{p.pendencia}</span> : null}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(p.valor_pagar_cents)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        {(ind.data?.por_consultora ?? []).length > 0 && (
          <details>
            <summary className="cursor-pointer text-ledger-muted">Indicadores por consultora</summary>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-ledger-muted"><tr><th className="py-1">Consultora</th><th>Acertos</th><th>Sem divergência</th><th>No prazo</th><th>Horas até encerrar</th></tr></thead>
              <tbody>{ind.data!.por_consultora.map((c) => (
                <tr key={c.consultora} className="border-t border-line-soft"><td className="py-1">{c.consultora}</td><td>{c.acertos}</td>
                  <td>{c.sem_divergencia_pct ?? "—"}%</td><td>{c.no_prazo_pct ?? "—"}%</td><td>{c.horas_media ?? "—"}</td></tr>))}</tbody>
            </table>
          </details>
        )}
      </div>
    </Panel>
  );
}

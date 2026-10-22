/**
 * Panorama em Remessas: maletas na rua só pelo SmallData (não existem na operação
 * do Lardan) e maletas do Lardan que a consultora não vê no app. Só leitura.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { visibilidadeMaletas } from "@/lib/maletas-visibilidade";

const dataBr = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

export function MaletasNaRua() {
  const [aberto, setAberto] = React.useState(false);
  const q = useQuery({ queryKey: ["maletas", "visibilidade"], queryFn: () => visibilidadeMaletas(300), staleTime: 60_000, retry: false });
  if (q.isError || !q.data) return null; // sem permissão ou carregando: não ocupa espaço
  const { lardan: l, smalldata: s } = q.data;
  if (s.maletas === 0 && l.invisiveis === 0) return null;

  return (
    <section className="rounded-2xl border border-warning/50 bg-warning/5">
      <button type="button" className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <span className="flex items-start gap-3">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <span className="text-sm text-ledger-text">
            {s.maletas > 0 && (
              <>
                <strong>{formatInt(s.maletas)} maletas estão na rua só pelo SmallData</strong> ({formatInt(s.consultoras)} consultoras,{" "}
                {formatInt(s.pecas)} peças, {formatBRLFromCents(s.valor_enviado_cents)} em varejo; {formatInt(s.atrasadas)} vencidas). Elas não existem na
                operação do Lardan, por isso não aparecem no app nem no cockpit da operação.{" "}
              </>
            )}
            {l.invisiveis > 0 && (
              <>
                <strong>{formatInt(l.invisiveis)} de {formatInt(l.ativas)} maletas do Lardan</strong> não aparecem no app da consultora.
              </>
            )}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("mt-0.5 size-5 shrink-0 transition-transform", aberto && "rotate-180")} />
      </button>
      {aberto && (
        <div className="space-y-5 border-t border-warning/30 px-5 py-4 text-sm">
          {l.lista.length > 0 && (
            <div>
              <p className="ledger-eyebrow mb-2">Maletas do Lardan que a consultora não vê</p>
              <ul className="space-y-1">
                {l.lista.map((m) => (
                  <li key={m.cycle_id}>
                    <Link to="/admin/maletas/$id" params={{ id: m.cycle_id }} className="admin-link">{m.kit}</Link>{" "}
                    {m.party_id ? (
                      <Link to="/admin/cobranca/$id" params={{ id: m.party_id }} className="admin-link">{m.consultora}</Link>
                    ) : (
                      <span>{m.consultora ?? "sem consultora"}</span>
                    )}
                    <span className="text-ledger-muted"> — {m.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.por_remessa.length > 0 && (
            <div className="overflow-x-auto">
              <p className="ledger-eyebrow mb-2">Na rua pelo SmallData, por remessa</p>
              <table className="w-full min-w-[40rem]">
                <thead className="text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                  <tr>
                    <th className="py-1.5">Remessa</th>
                    <th className="py-1.5">Praça</th>
                    <th className="py-1.5">Saída · vencimento</th>
                    <th className="py-1.5 text-right">Maletas</th>
                    <th className="py-1.5 text-right">Peças</th>
                    <th className="py-1.5 text-right">Valor enviado</th>
                  </tr>
                </thead>
                <tbody>
                  {s.por_remessa.map((r) => (
                    <tr key={`${r.remessa}-${r.praca ?? ""}`} className="border-t border-line-soft">
                      <td className="py-1.5 tabular-nums">{r.remessa}</td>
                      <td className="py-1.5">{r.praca ?? "—"}</td>
                      <td className="py-1.5 tabular-nums">{dataBr(r.emissao)} · {dataBr(r.vencimento)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInt(r.maletas)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInt(r.pecas)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatBRLFromCents(r.valor_enviado_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.sem_cadastro > 0 && (
                <p className="mt-2 text-xs text-ledger-muted">{formatInt(s.sem_cadastro)} dessas consultoras ainda não estão ligadas a um cadastro do Lardan.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

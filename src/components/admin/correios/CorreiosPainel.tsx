/**
 * Maletas nos Correios (0236): voltas atrasadas (5º dia sem postar → cobrança), envios recentes
 * e indicadores. Só leitura; as ações ficam na tela de cada maleta.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Panel, StatusBadge } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

interface Painel {
  envios: { id: string; cycle_id: string; kit: string; consultora: string | null; direcao: string; status: string; codigo_objeto: string | null;
    frete_cents: number | null; entregue_em: string | null; postado_em: string | null; created_at: string }[];
  alertas_volta: { id: string; cycle_id: string; kit: string; consultora: string | null; codigo_objeto: string | null; limite_postagem: string; dias_atraso: number }[];
  indicadores: { em_transito: number; aguardando_postagem: number; entregues_90d: number; frete_90d_cents: number; prazo_medio_dias: number | null; volta_no_prazo_pct: number | null };
}
const brl = (c: number | null | undefined) => (c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dt = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");

export function CorreiosPainel() {
  const q = useQuery({
    queryKey: ["correios-painel", "geral"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("correios_painel" as never, {} as never);
      if (error) throw error;
      return data as unknown as Painel;
    },
    retry: false,
  });
  if (q.error) return null;   // sem permissão ou ainda não publicado
  const d = q.data;
  if (!d) return null;
  const i = d.indicadores;
  return (
    <Panel title="Maletas nos Correios">
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Em trânsito", String(i.em_transito)], ["Aguardando postagem", String(i.aguardando_postagem)],
            ["Entregues (90 dias)", String(i.entregues_90d)], ["Frete (90 dias)", brl(i.frete_90d_cents)],
            ["Prazo médio", i.prazo_medio_dias == null ? "—" : `${i.prazo_medio_dias} dias`],
            ["Volta postada em até 5 dias", i.volta_no_prazo_pct == null ? "—" : `${i.volta_no_prazo_pct}%`],
          ].map(([r, v]) => (
            <div key={r} className="rounded-xl border border-line-soft p-3"><p className="ledger-eyebrow">{r}</p><p className="text-lg font-semibold tabular-nums">{v}</p></div>
          ))}
        </div>
        {d.alertas_volta.length > 0 && (
          <div className="rounded-xl border border-destructive/40 p-3">
            <p className="font-semibold text-destructive">Volta não postada no prazo — passar para a cobrança ({d.alertas_volta.length})</p>
            <ul className="mt-2 divide-y divide-line-soft">
              {d.alertas_volta.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <Link to="/admin/maletas/$id" params={{ id: a.cycle_id }} className="admin-link">{a.kit} · {a.consultora ?? "—"}</Link>
                  <span className="text-xs">código {a.codigo_objeto} · prazo {dt(a.limite_postagem)} · {a.dias_atraso} dia(s) de atraso</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.envios.length === 0 ? <p className="text-ledger-muted">Nenhuma maleta enviada pelos Correios ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ledger-muted"><tr><th className="py-1">Maleta</th><th>Consultora</th><th>Sentido</th><th>Código</th><th>Situação</th><th className="text-right">Frete</th></tr></thead>
              <tbody>
                {d.envios.slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-t border-line-soft">
                    <td className="py-1.5"><Link to="/admin/maletas/$id" params={{ id: e.cycle_id }} className="admin-link">{e.kit}</Link></td>
                    <td>{e.consultora ?? "—"}</td>
                    <td>{e.direcao === "ida" ? "Ida" : "Volta"}</td>
                    <td className="font-mono text-xs">{e.codigo_objeto ?? "—"}</td>
                    <td><StatusBadge tone={e.status === "entregue" ? "success" : e.status === "erro" ? "danger" : "neutral"}>{e.status.replace("_", " ")}</StatusBadge>
                      {e.entregue_em ? <span className="ml-1 text-xs text-ledger-muted">{dt(e.entregue_em)}</span> : null}</td>
                    <td className="text-right tabular-nums">{brl(e.frete_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

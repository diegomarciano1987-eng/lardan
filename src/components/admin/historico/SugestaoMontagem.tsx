/**
 * Painel "Sugestão de composição" na montagem da maleta: só mostra a leitura
 * do histórico SmallData. Não reserva, não acrescenta peça e não muda nada.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { sugestaoMontagem, type SugestaoMontagem } from "@/lib/historico-jflex";
import { supabase } from "@/integrations/supabase/client";

const SELO: Record<SugestaoMontagem["confianca"], { tone: "success" | "warning" | "danger"; texto: string }> = {
  alta: { tone: "success", texto: "Confiança alta" },
  media: { tone: "warning", texto: "Confiança média" },
  baixa: { tone: "danger", texto: "Confiança baixa" },
};

export function SugestaoMontagem({ partyId }: { partyId: string }) {
  const [texto, setTexto] = React.useState<string | null>(null);

  const padrao = useQuery({
    // Média vendida nas 3 últimas maletas dela + 30%; sem histórico, 35.
    queryKey: ["historico-jflex", "total-sugerido", partyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("maleta_total_sugerido" as never, { _party: partyId } as never);
      if (error) throw error;
      return (data as { total: number | null } | null)?.total ?? 35;
    },
    staleTime: 1000 * 60 * 5,
  });

  // Campo vazio enquanto digita não volta ao padrão; a sugestão usa o último valor válido.
  const digitado = texto != null && texto !== "" ? Number(texto) : null;
  const [ultimo, setUltimo] = React.useState<number | null>(null);
  React.useEffect(() => { if (digitado) setUltimo(digitado); }, [digitado]);
  const totalUsado = digitado || (texto != null ? ultimo : null) || padrao.data || null;
  const q = useQuery({
    queryKey: ["historico-jflex", "montagem", partyId, totalUsado],
    queryFn: () => sugestaoMontagem(partyId, totalUsado!),
    enabled: totalUsado != null,
  });

  if (padrao.isLoading) return <Skeleton className="h-24 w-full" />;
  const d = q.data;

  return (
    <Panel title="Sugestão de composição (histórico SmallData)">
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="ledger-eyebrow">Total de peças</span>
          <input
            className="admin-input w-32"
            inputMode="numeric"
            value={texto ?? (padrao.data != null ? String(padrao.data) : "")}
            onChange={(e) => setTexto(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        {d && <StatusBadge tone={SELO[d.confianca].tone}>{SELO[d.confianca].texto}</StatusBadge>}
      </div>
      {d?.como_ler && <p className="mt-3 text-sm font-medium text-ledger-muted">{d.como_ler}</p>}
      {q.isLoading && <div className="mt-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
      {q.isError && <p role="alert" className="mt-3 text-sm text-danger">Não foi possível ler a sugestão: {(q.error as Error).message}</p>}
      {d && d.categorias.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="py-2 pr-4">Categoria</th>
                <th className="py-2 pr-4 text-right">Peças sugeridas</th>
                <th className="py-2 pr-4 text-right">Participação</th>
                <th className="py-2 pr-4 text-right">Giro dela</th>
                <th className="py-2 pr-4 text-right">Giro da referência</th>
                <th className="py-2 text-right">Vendas dela</th>
              </tr>
            </thead>
            <tbody>
              {d.categorias.map((c) => (
                <tr key={c.categoria} className="border-b border-line-soft last:border-0">
                  <td className="py-2 pr-4 font-medium text-ledger-text">{c.categoria}</td>
                  <td className="py-2 pr-4 text-right tabular-nums font-semibold">{c.pecas_sugeridas}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.participacao_sugerida_pct}%</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.consultora_giro_pct != null ? `${c.consultora_giro_pct}%` : "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{c.referencia_giro_pct != null ? `${c.referencia_giro_pct}%` : "—"}</td>
                  <td className="py-2 text-right tabular-nums text-ledger-muted">{c.consultora_pecas_vendidas} de {c.consultora_pecas_enviadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-ledger-muted">
        A sugestão só mostra. Não reserva peça, não acrescenta na maleta e não muda o estoque.
      </p>
    </Panel>
  );
}

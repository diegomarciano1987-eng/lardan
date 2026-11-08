import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { brl, carteira, dataBR } from "@/lib/cobranca";

/** Linha de cob_acordos_atrasados_lista (0277): mesmo critério do indicador "Acordos atrasados". */
export type AcordoAtrasado = {
  party_id: string; simulacao_id: string; nome: string | null; codigo: string | null; documento: string | null;
  judicial: boolean; origem: string | null; total_cents: number; pago_cents: number; dias_atraso: number;
  parcelas_atrasadas: number; atrasado_cents: number; vencimento_mais_antigo: string | null; fatura_url: string | null;
  prorrogado: boolean; prorrogacao_motivo: string | null;
};

const rpc = (fn: string) =>
  (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown; error: { message: string } | null }>)(fn);

export const acordosAtrasadosQuery = {
  queryKey: ["cob", "acordos-atrasados"],
  queryFn: async () => {
    const { data, error } = await rpc("cob_acordos_atrasados_lista");
    if (error) throw new Error(error.message);
    return (data ?? []) as AcordoAtrasado[];
  },
};

const tipo = (a: AcordoAtrasado) => (a.judicial ? "Acordo judicial" : a.origem === "historica" ? "Fatura histórica" : "Acordo");

export function AcordosAtrasados({ onFechar }: { onFechar: () => void }) {
  const q = useQuery(acordosAtrasadosQuery);
  // Praça e representante vêm da carteira já carregada na tela (sem nova consulta quando em cache).
  const qc = useQuery({ queryKey: ["cob", "carteira"], queryFn: carteira, staleTime: 60_000 });
  const porPessoa = React.useMemo(() => new Map((qc.data ?? []).map((d) => [d.party_id, d])), [qc.data]);
  const lista = q.data ?? [];
  const totalAtrasado = lista.reduce((a, x) => a + Number(x.atrasado_cents), 0);

  return (
    <Panel
      title={`Acordos em atraso${q.data ? ` · ${lista.length}` : ""}`}
      action={<button onClick={onFechar} className="h-9 rounded-lg border border-border px-3 text-sm hover:border-primary/50">Voltar para a aba</button>}
      className="rounded-xl border border-border bg-card"
    >
      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando os acordos em atraso…</p>
        : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        : lista.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Sem dados: nenhum acordo com parcela vencida hoje.</p>
        : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {lista.length} {lista.length === 1 ? "pessoa está" : "pessoas estão"} com parcela de acordo vencida e não paga no Asaas · <span className="font-mono tabular-nums text-destructive">{brl(totalAtrasado)}</span> em atraso. Ordenado pelo maior atraso.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm" data-lista="acordos-atrasados">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>{["Pessoa", "Praça / representante", "Tipo", "Parcelas vencidas", "Valor em atraso", "Mais antiga", "Pago do acordo", "Prorrogação", "Fatura"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {lista.map((a) => {
                    const d = porPessoa.get(a.party_id);
                    return (
                      <tr key={a.simulacao_id} className="border-t border-border hover:bg-muted/30" data-pessoa={a.party_id}>
                        <td className="px-4 py-3">
                          <Link to="/admin/cobranca/$id" params={{ id: a.party_id }} className="font-medium hover:underline">{a.nome ?? "Sem nome no cadastro"}</Link>
                          <p className="text-xs text-muted-foreground">{[a.codigo ? `Cód. ${a.codigo}` : null, a.documento].filter(Boolean).join(" · ") || "Sem código"}</p>
                        </td>
                        <td className="px-4 py-3 text-xs"><p>{d?.praca_nome ?? "Sem praça"}</p><p className="text-muted-foreground">{d?.representante_nome ?? "Sem representante"}</p></td>
                        <td className="px-4 py-3 text-xs">{tipo(a)}</td>
                        <td className="px-4 py-3 tabular-nums">{a.parcelas_atrasadas}</td>
                        <td className="px-4 py-3 font-mono tabular-nums text-destructive">{brl(Number(a.atrasado_cents))}</td>
                        <td className="px-4 py-3 text-xs">{a.vencimento_mais_antigo ? dataBR(a.vencimento_mais_antigo) : "—"}<p className="font-semibold text-destructive">{a.dias_atraso} {a.dias_atraso === 1 ? "dia" : "dias"}</p></td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{brl(Number(a.pago_cents))} de {brl(Number(a.total_cents))}</td>
                        <td className="px-4 py-3 text-xs">{a.prorrogado ? <span title={a.prorrogacao_motivo ?? undefined}>Já prorrogado</span> : <span className="text-muted-foreground">Disponível</span>}</td>
                        <td className="px-4 py-3">{a.fatura_url
                          ? <a href={a.fatura_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md bg-asaas px-3 text-xs font-semibold text-asaas-foreground">Abrir fatura</a>
                          : <span className="text-xs text-muted-foreground">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </Panel>
  );
}

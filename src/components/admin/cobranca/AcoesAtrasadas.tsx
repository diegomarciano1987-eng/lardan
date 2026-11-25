import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR, rotuloEtapa, type Etapa } from "@/lib/cobranca";

/** Linha de cob_acoes_atrasadas_lista (0387): mesmo critério do card "Ações atrasadas" (próxima ação antes de hoje). */
export type AcaoAtrasada = {
  party_id: string; nome: string | null; codigo_legado: string | null; praca_nome: string | null; representante_nome: string | null;
  etapa: string; vencido_cents: number; proxima_acao: string; dias: number; titulo: string | null;
  tarefas_vencidas: number; da_regua: number; manuais: number;
};

/** Totais completos vêm do banco (sem limite de linhas); a tabela mostra as 300 mais antigas. */
type Resumo = { pessoas: number; da_regua: number; manuais: number; so_regua: number; linhas: AcaoAtrasada[] };

export function AcoesAtrasadas({ onFechar }: { onFechar: () => void }) {
  const q = useQuery({
    queryKey: ["cob", "acoes-atrasadas"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown; error: { message: string } | null }>)("cob_acoes_atrasadas_resumo");
      if (error) throw new Error(error.message);
      return data as Resumo;
    },
  });
  const lista = q.data?.linhas ?? [];
  const total = q.data?.pessoas ?? 0;
  const regua = q.data?.da_regua ?? 0;
  const manuais = q.data?.manuais ?? 0;
  const soRegua = q.data?.so_regua ?? 0;

  return (
    <Panel
      title={`Ações atrasadas${q.data ? ` · ${total}` : ""}`}
      action={<button onClick={onFechar} className="h-9 rounded-lg border border-border px-3 text-sm hover:border-primary/50">Voltar para a aba</button>}
      className="rounded-xl border border-border bg-card"
    >
      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando as ações atrasadas…</p>
        : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        : lista.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Sem dados: nenhuma ação vencida.</p>
        : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3" data-origem-acoes>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Pessoas com ação vencida</p><p className="font-mono text-lg tabular-nums">{total}</p></div>
              <div className="rounded-lg border border-asaas/40 p-3"><p className="text-xs text-asaas">Lembretes da régua automática vencidos</p><p className="font-mono text-lg tabular-nums">{regua}</p><p className="text-xs text-muted-foreground">{soRegua} pessoas só têm lembrete da régua</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">Ações criadas pela equipe vencidas</p><p className="font-mono text-lg tabular-nums">{manuais}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">
              Cada pessoa conta uma vez: entra aqui quando a próxima ação em aberto dela tem data anterior a hoje. A régua cria um lembrete a cada aviso do Asaas e ele fica aberto até alguém concluir na ficha da pessoa.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm" data-lista="acoes-atrasadas">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>{["Pessoa", "Praça / representante", "Etapa", "Ação mais antiga", "Vencida desde", "Ações vencidas", "Saldo vencido"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {lista.map((a) => (
                    <tr key={a.party_id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link to="/admin/cobranca/$id" params={{ id: a.party_id }} className="font-medium hover:underline">{a.nome ?? "Sem nome no cadastro"}</Link>
                        <p className="text-xs text-muted-foreground">{a.codigo_legado ? `Cód. ${a.codigo_legado}` : "Sem código"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs"><p>{a.praca_nome ?? "Sem praça"}</p><p className="text-muted-foreground">{a.representante_nome ?? "Sem representante"}</p></td>
                      <td className="px-4 py-3 text-xs">{rotuloEtapa(a.etapa as Etapa)}</td>
                      <td className="px-4 py-3 text-xs">{a.titulo ?? "—"}</td>
                      <td className="px-4 py-3 text-xs">{dataBR(a.proxima_acao)}<p className="font-semibold text-destructive">{a.dias} {a.dias === 1 ? "dia" : "dias"}</p></td>
                      <td className="px-4 py-3 text-xs tabular-nums">{a.tarefas_vencidas}<p className="text-muted-foreground">{a.da_regua} régua · {a.manuais} equipe</p></td>
                      <td className="px-4 py-3 font-mono tabular-nums">{brl(Number(a.vencido_cents))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > lista.length && <p className="text-xs text-muted-foreground">Mostrando as {lista.length} mais antigas de {total}.</p>}
          </div>
        )}
    </Panel>
  );
}

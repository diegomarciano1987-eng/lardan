/**
 * Conferência do saldo da conta Asaas (0235): saldo real (última linha do extrato do Asaas)
 * × saldo no Lardan, e o que explica a diferença, item por item. Só leitura: cada item diz
 * onde se resolve (mesa Asaas, estorno da baixa, título duplicado).
 */
import { useQuery } from "@tanstack/react-query";
import { Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

interface Item { data: string; valor_cents: number; pay: string | null; historico?: string; nome?: string | null; baixas?: number; importados?: number }
interface Conferencia {
  configurada: boolean;
  saldo_lardan_cents: number; saldo_asaas_cents: number | null; saldo_asaas_data: string | null; diferenca_cents: number;
  sem_lancamento: Item[]; sem_lancamento_cents: number;
  em_dinheiro: Item[]; em_dinheiro_cents: number;
  duplicados: Item[];
  por_mes: { mes: string; saldo_asaas_cents: number; saldo_lardan_cents: number; diferenca_cents: number }[];
}
const brl = (c: number | null | undefined) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const mesBR = (m: string) => { const [a, mm] = m.split("-"); return `${mm}/${a}`; };

export function ConferenciaSaldoAsaas() {
  const q = useQuery({
    queryKey: ["fin-asaas-conferencia"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fin_asaas_conferencia" as never, {} as never);
      if (error) throw error;
      return data as unknown as Conferencia;
    },
  });
  if (q.isLoading) return <Panel title="Conferência do saldo Asaas"><Skeleton className="h-24 w-full" /></Panel>;
  if (q.error) return <Panel title="Conferência do saldo Asaas"><p className="text-sm text-destructive">{(q.error as Error).message}</p></Panel>;
  const d = q.data;
  if (!d?.configurada) return null;
  const bate = Math.abs(d.diferenca_cents) < 1;
  const explicado = d.sem_lancamento_cents - d.em_dinheiro_cents - d.duplicados.reduce((a, x) => a + x.valor_cents * Math.max((x.baixas ?? 0) + (x.importados ?? 0) - 1, 1), 0);
  const resto = d.diferenca_cents - explicado;

  return (
    <Panel title="Conferência do saldo Asaas — extrato × Lardan">
      <div className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line-soft p-4">
            <p className="ledger-eyebrow">Saldo no Asaas</p>
            <p className="text-xl font-semibold tabular-nums">{brl(d.saldo_asaas_cents)}</p>
            <p className="text-xs text-ledger-muted">pelo extrato, até {dt(d.saldo_asaas_data)}</p>
          </div>
          <div className="rounded-xl border border-line-soft p-4">
            <p className="ledger-eyebrow">Saldo no Lardan</p>
            <p className="text-xl font-semibold tabular-nums">{brl(d.saldo_lardan_cents)}</p>
            <p className="text-xs text-ledger-muted">soma dos lançamentos da conta</p>
          </div>
          <div className={`rounded-xl border p-4 ${bate ? "border-success/40" : "border-warning/50"}`}>
            <p className="ledger-eyebrow">Diferença</p>
            <p className="text-xl font-semibold tabular-nums">{brl(d.diferenca_cents)}</p>
            <StatusBadge tone={bate ? "success" : "warning"}>{bate ? "Batendo" : "Asaas − Lardan"}</StatusBadge>
          </div>
        </div>

        {!bate && (
          <ul className="space-y-1 text-ledger-muted">
            <li>+ {brl(d.sem_lancamento_cents)} recebido no Asaas sem lançamento no Lardan ({d.sem_lancamento.length})</li>
            <li>− {brl(d.em_dinheiro_cents)} baixado na conta Asaas, mas o Asaas diz "recebida em dinheiro" ({d.em_dinheiro.length})</li>
            <li>− lançado mais de uma vez: {d.duplicados.length}</li>
            <li>{brl(resto)} tarifas e histórico anterior — veja a tabela por mês</li>
          </ul>
        )}

        {d.sem_lancamento.length > 0 && (
          <details className="rounded-xl border border-line-soft p-3" open={d.sem_lancamento.length <= 15}>
            <summary className="cursor-pointer font-semibold">Recebido no Asaas sem lançamento ({d.sem_lancamento.length} · {brl(d.sem_lancamento_cents)})</summary>
            <p className="mt-2 text-xs text-ledger-muted">Resolva na mesa abaixo: busque pelo código pay_ e vincule ao título da consultora (ou crie título novo).</p>
            <ul className="mt-2 divide-y divide-line-soft">
              {d.sem_lancamento.map((x) => (
                <li key={`${x.pay}-${x.data}`} className="flex justify-between gap-3 py-1.5">
                  <span>{dt(x.data)} · {x.historico}<span className="ml-1 text-xs text-ledger-muted">{x.pay}</span></span>
                  <span className="tabular-nums">{brl(x.valor_cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {d.em_dinheiro.length > 0 && (
          <details className="rounded-xl border border-line-soft p-3" open>
            <summary className="cursor-pointer font-semibold">Baixa na conta Asaas de cobrança "recebida em dinheiro" ({d.em_dinheiro.length} · {brl(d.em_dinheiro_cents)})</summary>
            <p className="mt-2 text-xs text-ledger-muted">O dinheiro não entrou no Asaas. Estorne a baixa e lance de novo na conta onde ele entrou (Pix no banco, dinheiro na praça).</p>
            <ul className="mt-2 divide-y divide-line-soft">
              {d.em_dinheiro.map((x) => (
                <li key={`${x.pay}-${x.data}`} className="flex justify-between gap-3 py-1.5">
                  <span>{dt(x.data)} · {x.nome ?? "—"}<span className="ml-1 text-xs text-ledger-muted">{x.pay}</span></span>
                  <span className="tabular-nums">{brl(x.valor_cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {d.duplicados.length > 0 && (
          <details className="rounded-xl border border-line-soft p-3" open>
            <summary className="cursor-pointer font-semibold">Recebimento lançado mais de uma vez ({d.duplicados.length})</summary>
            <ul className="mt-2 divide-y divide-line-soft">
              {d.duplicados.map((x) => (
                <li key={`${x.pay}-${x.data}`} className="flex justify-between gap-3 py-1.5">
                  <span>{dt(x.data)} · {x.historico}<span className="ml-1 text-xs text-ledger-muted">{x.pay} · {(x.baixas ?? 0) + (x.importados ?? 0)} lançamentos</span></span>
                  <span className="tabular-nums">{brl(x.valor_cents)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {d.por_mes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ledger-muted">
                <tr><th className="py-1">Mês (fim)</th><th className="text-right">Asaas</th><th className="text-right">Lardan</th><th className="text-right">Diferença</th><th className="text-right">Nasceu no mês</th></tr>
              </thead>
              <tbody>
                {d.por_mes.map((m, i) => {
                  const nasceu = m.diferenca_cents - (i > 0 ? d.por_mes[i - 1]!.diferenca_cents : 0);
                  return (
                    <tr key={m.mes} className="border-t border-line-soft">
                      <td className="py-1.5">{mesBR(m.mes)}</td>
                      <td className="text-right tabular-nums">{brl(m.saldo_asaas_cents)}</td>
                      <td className="text-right tabular-nums">{brl(m.saldo_lardan_cents)}</td>
                      <td className="text-right tabular-nums">{brl(m.diferenca_cents)}</td>
                      <td className={`text-right tabular-nums ${Math.abs(nasceu) >= 1 ? "font-semibold text-warning" : "text-ledger-muted"}`}>{brl(nasceu)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

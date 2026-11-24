/**
 * Aba "Compras da cliente" (0382): painel somente leitura da consumidora final —
 * resumo, pedidos com peças (referência na frente), consultoras que atenderam,
 * títulos e cobranças Asaas. Tudo vem de cliente_cockpit; nada é calculado aqui além de formatação.
 */
import { useQuery } from "@tanstack/react-query";
import { Panel, Skeleton, StatusBadge, ErrorState, EmptyState } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

interface Item { referencia: string | null; produto: string; variante: string | null; quantidade: number; unitario_cents: number }
interface Pedido {
  id: string; codigo: string; data: string; status: string; pagamento: string; entrega: string; forma: string | null;
  valor_cents: number; pago_em: string | null; consultora: string | null; itens: Item[];
}
interface Cockpit {
  resumo: { pedidos: number; pecas: number; total_cents: number; pago_cents: number; ultima_compra: string | null; em_aberto_cents: number };
  consultoras: { party_id: string; nome: string; codigo: string; pedidos: number }[];
  pedidos: Pedido[];
  titulos: { id: string; numero: string; descricao: string; status: string; emissao: string; valor_cents: number; saldo_cents: number; pago_cents: number }[];
  asaas: { cobranca: string; status: string; forma: string; valor_cents: number; vencimento: string | null; pago_em: string | null }[];
}
const brl = (c: number | null | undefined) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const PAG: Record<string, string> = { pago: "Pago", pendente: "Aguardando pagamento", nao_iniciado: "Sem pagamento", estornado: "Estornado" };
const FORMA: Record<string, string> = { pix: "Pix", cartao: "Cartão", boleto: "Boleto", dinheiro: "Dinheiro (com a consultora)", fiado: "Fiado" };

export function ComprasCliente({ partyId }: { partyId: string }) {
  const q = useQuery({
    queryKey: ["cliente-cockpit", partyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cliente_cockpit" as never, { _party: partyId } as never);
      if (error) throw error;
      return data as unknown as Cockpit;
    },
  });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorState message={`Não foi possível carregar as compras. ${(q.error as Error)?.message ?? ""}`} onRetry={() => q.refetch()} />;
  const d = q.data;
  const r = d.resumo;
  const ticket = r.pedidos > 0 ? Math.round(r.total_cents / r.pedidos) : 0;
  const cards: [string, string][] = [
    ["Total comprado", brl(r.total_cents)], ["Pedidos", String(r.pedidos)], ["Peças", String(r.pecas)],
    ["Ticket médio", brl(ticket)], ["Pago", brl(r.pago_cents)], ["Em aberto", brl(r.em_aberto_cents)], ["Última compra", dia(r.ultima_compra)],
  ];
  return (
    <div className="space-y-4" data-testid="compras-cliente">
      <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map(([t, v]) => (
          <div key={t} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-muted-foreground">{t}</div>
            <strong className="mt-1 block text-lg font-semibold tabular-nums">{v}</strong>
          </div>
        ))}
      </div>

      <Panel title="Consultoras que atenderam">
        {d.consultoras.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
          <ul className="flex flex-wrap gap-2">
            {d.consultoras.map((c) => (
              <li key={c.party_id} className="rounded-md border border-border px-3 py-1.5 text-sm">
                [Cód. {c.codigo}] {c.nome} · {c.pedidos} pedido{c.pedidos === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Pedidos e peças">
        {d.pedidos.length === 0 ? <EmptyState title="Sem compras registradas" description="Nenhum pedido ligado a esta cliente." /> : (
          <div className="space-y-3">
            {d.pedidos.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <strong className="font-semibold">{p.codigo}</strong>
                  <span>{dia(p.data)}</span>
                  <span className="text-muted-foreground">{p.consultora ?? "—"}</span>
                  <span>{p.forma ? (FORMA[p.forma] ?? p.forma) : "Forma não informada"}</span>
                  <StatusBadge tone={p.status === "cancelado" ? "neutral" : p.pagamento === "pago" ? "success" : "warning"}>
                    {p.status === "cancelado" ? "Cancelado" : (PAG[p.pagamento] ?? p.pagamento)}
                  </StatusBadge>
                  <span className="ml-auto font-semibold tabular-nums">{brl(p.valor_cents)}</span>
                </div>
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {p.itens.map((i, k) => (
                      <tr key={k} className="border-t border-border">
                        <td className="py-1.5 pr-3 font-mono text-xs">{i.referencia ?? "Sem referência"}</td>
                        <td className="py-1.5 pr-3">{i.produto}{i.variante ? ` · ${i.variante}` : ""}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{i.quantidade}×</td>
                        <td className="py-1.5 text-right tabular-nums">{brl(i.unitario_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Financeiro">
        {d.titulos.length === 0 && d.asaas.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
          <div className="space-y-4">
            {d.titulos.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Título</th><th>Descrição</th><th>Emissão</th><th className="text-right">Valor</th><th className="text-right">Pago</th><th className="text-right">Em aberto</th><th className="text-right">Situação</th></tr></thead>
                <tbody>
                  {d.titulos.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="py-1.5 font-mono text-xs">{t.numero}</td><td>{t.descricao}</td><td>{dia(t.emissao)}</td>
                      <td className="text-right tabular-nums">{brl(t.valor_cents)}</td><td className="text-right tabular-nums">{brl(t.pago_cents)}</td>
                      <td className="text-right tabular-nums">{brl(t.saldo_cents)}</td>
                      <td className="text-right">{t.status === "cancelado" ? "Cancelado" : t.saldo_cents === 0 ? "Quitado" : "Aberto"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.asaas.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-asaas">Cobranças no Asaas</div>
                <table className="w-full text-sm"><tbody>
                  {d.asaas.map((c) => (
                    <tr key={c.cobranca} className="border-t border-border">
                      <td className="py-1.5 font-mono text-xs">{c.cobranca}</td><td>{c.forma}</td><td>{c.status}</td>
                      <td>Venc. {dia(c.vencimento)}</td><td>{c.pago_em ? `Pago ${dia(c.pago_em)}` : ""}</td>
                      <td className="text-right tabular-nums">{brl(c.valor_cents)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

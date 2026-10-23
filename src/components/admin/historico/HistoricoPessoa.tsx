/**
 * Histórico do SmallData ligado a um cadastro de pessoa. Somente leitura sobre a
 * operação; o banco decide quem vê (consultora só vê o próprio histórico).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EmptyState, ErrorState, Panel, Skeleton, formatBRLFromCents } from "@/components/admin/ui";
import { historicoConsultora, type CategoriaHistorico } from "@/lib/historico-jflex";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComissaoMaletas } from "@/components/admin/historico/ComissaoMaletas";

const brl = formatBRLFromCents;
const data = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

function Dado({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums ${destaque ? "text-bronze" : "text-ledger-text"}`}>{valor}</p>
    </div>
  );
}

function BarrasCategorias({ categorias }: { categorias: CategoriaHistorico[] }) {
  const max = Math.max(...categorias.map((c) => c.participacao_vendas_pct ?? 0), 1);
  return (
    <div className="space-y-4">
      {categorias.map((c) => {
        const acimaDaPraca = c.giro_praca_pct != null && c.giro_pct != null && c.giro_pct > c.giro_praca_pct;
        return (
          <div key={c.categoria}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold text-ledger-text">
                {c.categoria}
                {acimaDaPraca && (
                  <span className="ml-2 rounded-lg border border-success px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-success">
                    vende acima da praça
                  </span>
                )}
              </span>
              <span className="tabular-nums text-ledger-muted">
                {c.pecas_vendidas} vendidas · {brl(c.valor_vendido_cents)} · giro {c.giro_pct ?? "—"}%
                {c.giro_praca_pct != null ? ` (praça ${c.giro_praca_pct}%)` : ""}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-bronze" style={{ width: `${Math.round(((c.participacao_vendas_pct ?? 0) / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HistoricoJFlexPessoa({ partyId }: { partyId: string }) {
  const q = useQuery({ queryKey: ["historico-jflex", "consultora", partyId], queryFn: () => historicoConsultora(partyId) });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;

  const d = q.data;
  if (!d?.vinculada) {
    return (
      <EmptyState
        title="Nenhum histórico do SmallData ligado a este cadastro"
        description="Este cadastro não está ligado a nenhuma consultora do histórico SmallData. O vínculo manual é feito na tela Histórico SmallData das Configurações, só pelo Master."
      />
    );
  }
  const r = d.resumo;

  return (
    <Tabs defaultValue="visao">
      <TabsList>
        <TabsTrigger value="visao">Visão geral e vendas</TabsTrigger>
        <TabsTrigger value="comissao">Comissão por maletas</TabsTrigger>
      </TabsList>
      <TabsContent value="comissao" className="mt-4"><ComissaoMaletas maletas={(d.maletas ?? []) as never} /></TabsContent>
      <TabsContent value="visao" className="mt-4">
    <div className="space-y-6">
      {d.filtro_representante && (
        <p className="rounded-xl border border-line-soft bg-surface-muted p-4 text-sm text-ledger-text">
          Mostrando só as remessas do representante <strong>{d.filtro_representante.nome ?? "vinculado"}</strong>:{" "}
          {d.filtro_representante.remessas} de {d.filtro_representante.remessas_total} remessas desta consultora no SmallData.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Dado rotulo="Maletas" valor={`${r?.maletas ?? 0} (${r?.maletas_fechadas ?? 0} fechadas)`} />
        <Dado rotulo="Primeira · última maleta" valor={`${data(r?.primeira_maleta)} · ${data(r?.ultima_maleta)}`} />
        <Dado rotulo="Peças vendidas" valor={`${r?.pecas_vendidas ?? 0} · giro ${r?.giro_pct ?? "—"}%`} />
        <Dado rotulo="Valor vendido" valor={brl(r?.valor_vendido_cents ?? 0)} />
        <Dado rotulo="Ticket médio por maleta" valor={r?.ticket_medio_maleta_cents ? brl(r.ticket_medio_maleta_cents) : "Sem dados"} />
        <Dado rotulo="Maletas perdidas" valor={`${r?.maletas_perdidas ?? 0}`} />
        <Dado rotulo="Peças com defeito" valor={`${r?.pecas_defeito ?? 0}`} />
        {d.praca?.nome && <Dado rotulo="Praça no SmallData" valor={d.praca.nome} />}
      </div>

      <Panel title="Categorias — participação nas vendas e giro comparado à praça">
        {d.categorias && d.categorias.length > 0 ? <BarrasCategorias categorias={d.categorias} /> : <p className="text-sm text-ledger-muted">Sem dados.</p>}
      </Panel>

      <Panel title="Top produtos vendidos" flush>
        {d.produtos_top && d.produtos_top.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-6 py-3">Produto</th>
                <th className="px-6 py-3">Referência</th>
                <th className="px-6 py-3">Categoria</th>
                <th className="px-6 py-3 text-right">Quantidade</th>
                <th className="px-6 py-3 text-right">Valor vendido</th>
              </tr>
            </thead>
            <tbody>
              {d.produtos_top.map((p) => (
                <tr key={p.produto} className="border-b border-line-soft last:border-0">
                  <td className="px-6 py-3 font-medium text-ledger-text">
                    {p.product_id ? (
                      <Link to="/admin/cadastros/produtos/$id" params={{ id: p.product_id }} className="admin-link">
                        {p.nome ?? "Produto"}
                      </Link>
                    ) : (
                      (p.nome ?? "Produto")
                    )}
                  </td>
                  <td className="px-6 py-3 text-ledger-muted">{p.referencia ?? "—"}</td>
                  <td className="px-6 py-3 text-ledger-muted">{p.categoria ?? "—"}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{p.quantidade}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold">{brl(p.valor_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-6 py-5"><p className="text-sm text-ledger-muted">Sem dados.</p></div>
        )}
      </Panel>

      {d.por_ano && d.por_ano.length > 0 && (
        <Panel title="Evolução por ano" flush>
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-6 py-3">Ano</th>
                <th className="px-6 py-3 text-right">Maletas</th>
                <th className="px-6 py-3 text-right">Peças vendidas</th>
                <th className="px-6 py-3 text-right">Valor vendido</th>
              </tr>
            </thead>
            <tbody>
              {d.por_ano.map((a) => (
                <tr key={a.ano} className="border-b border-line-soft last:border-0">
                  <td className="px-6 py-3 font-semibold text-ledger-text">{a.ano}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{a.maletas}</td>
                  <td className="px-6 py-3 text-right tabular-nums">{a.pecas_vendidas}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold">{brl(a.valor_vendido_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Maletas do histórico" flush>
        {d.maletas && d.maletas.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
                <tr>
                  <th className="px-6 py-3">Remessa</th>
                  <th className="px-6 py-3">Kit</th>
                  <th className="px-6 py-3">Emissão</th>
                  <th className="px-6 py-3">Acerto</th>
                  <th className="px-6 py-3 text-right">Enviadas</th>
                  <th className="px-6 py-3 text-right">Devolvidas</th>
                  <th className="px-6 py-3 text-right">Vendidas</th>
                  <th className="px-6 py-3 text-right">Giro</th>
                  <th className="px-6 py-3 text-right">Valor vendido</th>
                  <th className="px-6 py-3">Notas</th>
                </tr>
              </thead>
              <tbody>
                {d.maletas.map((m, i) => (
                  <tr key={`${m.remessa}-${m.kit}-${m.tipo}-${i}`} className="border-b border-line-soft last:border-0">
                    <td className="px-6 py-3 font-semibold text-ledger-text">{m.remessa}</td>
                    <td className="px-6 py-3">{m.kit}</td>
                    <td className="px-6 py-3">{data(m.emissao)}</td>
                    <td className="px-6 py-3">{data(m.fechamento)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{m.pecas_enviadas}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{m.pecas_devolvidas}</td>
                    {/* null = maleta sem acerto: a venda ainda é desconhecida, nunca zero */}
                    <td className="px-6 py-3 text-right tabular-nums">{m.pecas_vendidas ?? "sem acerto"}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{m.giro_pct != null ? `${m.giro_pct}%` : "—"}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{m.valor_vendido_cents != null ? brl(m.valor_vendido_cents) : "—"}</td>
                    <td className="px-6 py-3 text-xs text-ledger-muted">
                      {[["remessa", m.nf_remessa], ["devolução", m.nf_devolucao], ["venda", m.nf_venda], [m.tipo === "perdida" ? "perda" : "", m.nf_perda]]
                        .filter(([k, v]) => k && v)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-5"><p className="text-sm text-ledger-muted">Sem dados.</p></div>
        )}
      </Panel>
    </div>
      </TabsContent>
    </Tabs>
  );
}

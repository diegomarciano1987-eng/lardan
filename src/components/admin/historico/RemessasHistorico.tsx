/**
 * Lista de remessas do histórico JFLEX no cockpit, com painel lateral de
 * detalhe. Somente leitura: nada muda na operação.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";
import { EmptyState, ErrorState, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { DateRangeField } from "@/components/premium/DateRangeField";
import type { DateRange } from "react-day-picker";
import { remessaHistorico, remessasHistorico, type RemessaHistorico } from "@/lib/historico-jflex";
import { isoDia } from "@/lib/remessas";

const brl = formatBRLFromCents;
const data = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

type Detalhe = {
  remessa: { numero: number; emissao: string | null; vencimento: string | null; status: "aberta" | "fechada"; praca_nome: string | null; representante_nome: string | null };
  categorias: { categoria: string; pecas_enviadas: number; pecas_vendidas: number | null; giro_pct: number | null; giro_praca_pct: number | null; participacao_vendas_pct: number | null; valor_vendido_cents?: number }[];
  maletas: { codcli: number; kit: number; tipo: string; nome: string | null; cidade: string | null; party_id: string | null; emissao: string | null; fechamento: string | null; pecas_enviadas: number; pecas_devolvidas: number; pecas_vendidas: number | null; pecas_defeito: number; valor_enviado_cents: number; valor_vendido_cents: number | null }[];
};

function PainelDetalhe({ numero, onFechar }: { numero: number; onFechar: () => void }) {
  const q = useQuery({ queryKey: ["historico-jflex", "remessa", numero], queryFn: () => remessaHistorico(numero) });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data as unknown as Detalhe | null;
  if (!d) return <p className="text-sm text-ledger-muted">Remessa não encontrada no histórico.</p>;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-semibold text-ledger-text">Remessa {d.remessa.numero}</p>
          <p className="text-sm text-ledger-muted">
            {d.remessa.praca_nome ?? "Sem praça"} · {d.remessa.representante_nome ?? "Entrega direta"} · emissão {data(d.remessa.emissao)} · acerto {data(d.remessa.vencimento)}
          </p>
        </div>
        <button type="button" className="admin-btn" onClick={onFechar} aria-label="Fechar detalhe">
          <X aria-hidden className="size-4" />
        </button>
      </div>

      {d.categorias.length > 0 && (
        <div>
          <p className="ledger-eyebrow mb-2">Categorias da remessa</p>
          <div className="space-y-2">
            {d.categorias.map((c) => (
              <div key={c.categoria} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-ledger-text">{c.categoria}</span>
                <span className="tabular-nums text-ledger-muted">
                  {c.pecas_enviadas} enviadas · {c.pecas_vendidas ?? "sem acerto"} vendidas · giro {c.giro_pct ?? "—"}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="ledger-eyebrow mb-2">Maletas da remessa</p>
        <div className="divide-y divide-line-soft rounded-xl border border-line-soft bg-surface">
          {d.maletas.map((m, i) => (
            <div key={`${m.codcli}-${m.kit}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0 font-medium text-ledger-text">
                {m.party_id ? (
                  <Link to="/admin/cadastros/pessoas/$id" params={{ id: m.party_id }} className="admin-link">
                    {m.nome ?? `Código ${m.codcli}`}
                  </Link>
                ) : (
                  (m.nome ?? `Código ${m.codcli}`)
                )}
                <span className="ml-2 text-xs text-ledger-muted">kit {m.kit}{m.tipo === "perdida" ? " · perdida" : ""}</span>
              </span>
              <span className="tabular-nums text-ledger-muted">
                {m.pecas_enviadas} enviadas · {m.pecas_vendidas ?? "sem acerto"} vendidas · {m.valor_vendido_cents != null ? brl(m.valor_vendido_cents) : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RemessasHistorico({ abrir, aoAbrir }: { abrir: number | null; aoAbrir: (n: number | null) => void }) {
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState("todas");
  const [periodo, setPeriodo] = React.useState<DateRange | undefined>();
  const [pagina, setPagina] = React.useState(0);
  const LIMITE = 50;
  React.useEffect(() => {
    const t = setTimeout(() => setBusca(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  React.useEffect(() => {
    setPagina(0);
  }, [busca, status, periodo]);

  const lista = useQuery({
    queryKey: ["historico-jflex", "remessas", busca, status, periodo, pagina],
    queryFn: () =>
      remessasHistorico({
        busca,
        status: status === "todas" ? null : (status as "aberta" | "fechada"),
        de: isoDia(periodo?.from),
        ate: isoDia(periodo?.to ?? periodo?.from),
        limite: LIMITE,
        offset: pagina * LIMITE,
      }),
  });

  const itens: RemessaHistorico[] = lista.data?.itens ?? [];
  const total = lista.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-12">
        <label className="grid gap-1.5 text-sm lg:col-span-5">
          <span className="ledger-eyebrow">Buscar</span>
          <input className="admin-input w-full" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Nº da remessa, praça, representante ou consultora" />
        </label>
        <label className="grid gap-1.5 text-sm lg:col-span-3">
          <span className="ledger-eyebrow">Situação</span>
          <SmartSelect
            value={status}
            onChange={setStatus}
            options={[
              { value: "todas", label: "Todas as situações" },
              { value: "aberta", label: "Aberta" },
              { value: "fechada", label: "Fechada" },
            ]}
            placeholder="Situação"
          />
        </label>
        <label className="grid gap-1.5 text-sm lg:col-span-4">
          <span className="ledger-eyebrow">Período</span>
          <DateRangeField value={periodo} onChange={setPeriodo} placeholder="Qualquer data" />
        </label>
      </div>

      {lista.isLoading && <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {lista.isError && <ErrorState message={(lista.error as Error).message} onRetry={() => void lista.refetch()} />}
      {!lista.isLoading && !lista.isError && itens.length === 0 && (
        <EmptyState title={busca || status !== "todas" || periodo ? "Nenhuma remessa histórica com estes filtros" : "Nenhuma remessa histórica importada"}
          description="O histórico aparece aqui depois da importação do JFLEX nas Configurações." />
      )}

      {itens.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line-soft bg-surface">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-line-soft text-left text-xs uppercase tracking-[0.08em] text-ledger-muted">
              <tr>
                <th className="px-4 py-3">Nº</th>
                <th className="px-4 py-3">Emissão</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Praça</th>
                <th className="px-4 py-3">Representante</th>
                <th className="px-4 py-3 text-right">Maletas</th>
                <th className="px-4 py-3 text-right">Consultoras</th>
                <th className="px-4 py-3 text-right">Enviadas</th>
                <th className="px-4 py-3 text-right">Vendidas</th>
                <th className="px-4 py-3 text-right">Giro</th>
                <th className="px-4 py-3 text-right">Valor vendido</th>
                <th className="px-4 py-3 text-right">Sem acerto</th>
                <th className="px-4 py-3" aria-label="Abrir detalhe" />
              </tr>
            </thead>
            <tbody>
              {itens.map((r) => (
                <tr key={r.numero} className="border-b border-line-soft last:border-0 hover:bg-surface-muted">
                  <td className="px-4 py-3 font-semibold text-ledger-text">{r.numero}</td>
                  <td className="px-4 py-3">{data(r.emissao)}</td>
                  <td className="px-4 py-3">{data(r.vencimento)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={r.status === "fechada" ? "neutral" : "info"}>{r.status === "fechada" ? "Fechada" : "Aberta"}</StatusBadge>
                  </td>
                  <td className="px-4 py-3">{r.praca ?? "—"}</td>
                  <td className="px-4 py-3">{r.representante ?? "Entrega direta"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.maletas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.consultoras}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.pecas_enviadas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.pecas_vendidas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.giro_pct != null ? `${r.giro_pct}%` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{brl(r.valor_vendido_cents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.maletas_sem_acerto}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="admin-link inline-flex items-center" onClick={() => aoAbrir(r.numero)} aria-label={`Detalhe da remessa ${r.numero}`}>
                      <ChevronRight aria-hidden className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button type="button" className="admin-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
          <span className="text-ledger-muted">Página {pagina + 1} de {paginas} · {formatIntTotal(total)} remessas</span>
          <button type="button" className="admin-btn" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
        </div>
      )}

      {abrir != null && (
        <div className="rounded-2xl border border-line-soft bg-surface p-6">
          <PainelDetalhe numero={abrir} onFechar={() => aoAbrir(null)} />
        </div>
      )}
    </div>
  );
}

function formatIntTotal(n: number) {
  return new Intl.NumberFormat("pt-BR").format(n);
}

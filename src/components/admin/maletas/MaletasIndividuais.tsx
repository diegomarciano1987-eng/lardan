import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge } from "@/components/admin/ui";
import { comCodigo } from "@/lib/busca-maletas";
import { SITUACAO_MALETA, brl, traduzir } from "@/lib/maletas";
import { buscarMaletasIndividuais, dataBR, type SituacaoIndividual } from "@/lib/remessas";

const TOM = { neutro: "neutral", aviso: "warning", ok: "success", erro: "danger" } as const;
const OPCOES: { v: SituacaoIndividual; r: string }[] = [
  { v: "abertas", r: "Em andamento" },
  { v: "encerradas", r: "Encerradas" },
  { v: "todas", r: "Todas" },
];

/** 0362: maletas abertas direto (sem remessa de praça nem representante, só um responsável). */
export function MaletasIndividuais() {
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [situacao, setSituacao] = React.useState<SituacaoIndividual>("abertas");
  React.useEffect(() => {
    const t = setTimeout(() => setBusca(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const q = useQuery({
    queryKey: ["remessas", "individuais", busca, situacao],
    queryFn: () => buscarMaletasIndividuais(busca, situacao),
    placeholderData: (anterior) => anterior,
  });
  const linhas = q.data ?? [];
  const pecas = linhas.reduce((a, m) => a + Number(m.pecas ?? 0), 0);
  const valor = linhas.reduce((a, m) => a + Number(m.valor_cents ?? 0), 0);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid min-w-[280px] flex-1 gap-1.5 text-sm">
            <span className="ledger-eyebrow">Buscar maleta individual</span>
            <span className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" />
              <input className="admin-input w-full pl-9 pr-9" value={texto} onChange={(e) => setTexto(e.target.value)}
                aria-label="Buscar maleta individual"
                placeholder="Maleta (MAL-00467), nº da remessa, consultora (nome, código ou CPF), responsável ou praça" />
              {texto && (
                <button type="button" aria-label="Limpar busca" onClick={() => setTexto("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ledger-muted hover:text-ledger-text">
                  <X className="size-4" />
                </button>
              )}
            </span>
          </label>
          <div role="radiogroup" aria-label="Situação" className="flex gap-1 rounded-[10px] border border-line-soft p-1">
            {OPCOES.map((o) => (
              <button key={o.v} type="button" role="radio" aria-checked={situacao === o.v} onClick={() => setSituacao(o.v)}
                className={`rounded-[8px] px-3 py-1.5 text-sm font-medium ${situacao === o.v ? "bg-primary text-primary-foreground" : "text-ledger-muted hover:text-ledger-text"}`}>
                {o.r}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-ledger-muted">
          Maletas abertas pelo botão "Nova maleta": sem praça de remessa nem representante, só com um responsável. Elas não aparecem na lista de remessas.
        </p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        {[["Maletas", String(linhas.length)], ["Peças", String(pecas)], ["Valor consignado", brl(valor)]].map(([r, v]) => (
          <div key={r} className="rounded-xl border border-line-soft bg-surface p-4">
            <p className="ledger-eyebrow">{r}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ledger-text">{v}</p>
          </div>
        ))}
      </div>

      <Panel flush>
        {q.isLoading && <div className="space-y-2 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {q.isError && <div className="px-6"><ErrorState message={traduzir(q.error)} onRetry={() => void q.refetch()} /></div>}
        {q.isSuccess && linhas.length === 0 && (
          <div className="px-6 py-2">
            <EmptyState title={busca.trim().length >= 2 ? "Nenhuma maleta individual com essa busca" : "Nenhuma maleta individual"}
              description={busca.trim().length >= 2 ? "Confira o número da maleta, o nome ou o código da consultora." : "Quando uma maleta for aberta direto, sem remessa de praça, ela aparece aqui."} />
          </div>
        )}
        {linhas.length > 0 && (
          <div className="hidden grid-cols-[120px_minmax(0,1.6fr)_minmax(0,1fr)_110px_110px_120px_130px] gap-4 border-b border-line-soft px-6 py-3 text-xs font-medium text-ledger-muted lg:grid">
            <span>Maleta</span><span>Consultora</span><span>Responsável</span><span>Acerto</span><span className="text-right">Peças</span><span className="text-right">Valor</span><span>Situação</span>
          </div>
        )}
        {linhas.map((m) => {
          const s = SITUACAO_MALETA[m.status];
          return (
            <Link key={m.cycle_id} to="/admin/maletas/$id" params={{ id: m.cycle_id }}
              className="grid grid-cols-1 gap-1 border-b border-line-soft px-6 py-3 text-sm transition hover:bg-surface-muted lg:grid-cols-[120px_minmax(0,1.6fr)_minmax(0,1fr)_110px_110px_120px_130px] lg:items-center lg:gap-4">
              <span className="font-semibold tabular-nums text-ledger-text">{m.maleta}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ledger-text">{comCodigo(m.consultora, m.consultora_codigo) || "Sem consultora"}</span>
                <span className="block truncate text-xs text-ledger-muted">Remessa {m.remessa_numero} · {m.praca}</span>
              </span>
              <span className="truncate text-ledger-muted">{m.responsavel}</span>
              <span className="tabular-nums text-ledger-muted">{dataBR(m.data_acerto)}</span>
              <span className="tabular-nums text-ledger-muted lg:text-right">{m.pecas} peças</span>
              <span className="tabular-nums font-semibold text-ledger-text lg:text-right">{brl(Number(m.valor_cents ?? 0))}</span>
              <StatusBadge tone={s ? TOM[s.tom] : "neutral"}>{s?.rotulo ?? m.status}</StatusBadge>
            </Link>
          );
        })}
      </Panel>
    </div>
  );
}

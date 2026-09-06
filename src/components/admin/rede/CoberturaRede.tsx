import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, Panel, formatInt } from "@/components/admin/ui";
import { coberturaRede, type FiltrosRede } from "@/lib/rede/consultas";

export function CoberturaRede({ filtros }: { filtros: FiltrosRede }) {
  const q = useQuery({
    queryKey: ["rede-cobertura", filtros],
    queryFn: () => coberturaRede(filtros),
  });

  if (q.error)
    return <ErrorState message="Não foi possível ler a cobertura." onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data)
    return <p className="text-sm text-ledger-muted">Lendo a cobertura territorial…</p>;

  const c = q.data;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Cobertura em números">
        <dl className="grid grid-cols-2 gap-4">
          <Numero rotulo="Estados atendidos" valor={c.estados_atendidos} />
          <Numero rotulo="Estados sem cobertura" valor={c.estados_sem_cobertura.length} />
          <Numero rotulo="Municípios atendidos" valor={c.municipios_atendidos} />
          <Numero rotulo="Municípios com uma só consultora" valor={c.municipios_unica_consultora} />
          <Numero rotulo="Sem território válido" valor={c.sem_territorio} />
          <Numero rotulo="Localizações pendentes" valor={c.localizacoes_pendentes} />
        </dl>
      </Panel>

      <Panel title="Distribuição por estado">
        {c.por_uf.filter((u) => u.total > 0).length === 0 ? (
          <EmptyState
            title="Nenhum estado com rede cadastrada"
            description="Assim que houver consultora com endereço, a distribuição aparece aqui."
          />
        ) : (
          <ul className="space-y-2">
            {c.por_uf
              .filter((u) => u.total > 0)
              .map((u) => (
                <li key={u.uf} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ledger-text">
                    {u.nome} <span className="text-ledger-muted">({u.uf})</span>
                  </span>
                  <span className="font-semibold [font-variant-numeric:tabular-nums]">
                    {formatInt(u.total)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <Panel title="Maior concentração por município">
        {c.municipios_concentrados.length === 0 ? (
          <EmptyState title="Sem dados de município" description="Nenhum endereço com município informado." />
        ) : (
          <ul className="space-y-2">
            {c.municipios_concentrados.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ledger-text">
                  {m.municipio} <span className="text-ledger-muted">/ {m.uf}</span>
                </span>
                <span className="font-semibold [font-variant-numeric:tabular-nums]">
                  {formatInt(m.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Distribuição por representante">
        {c.por_representante.length === 0 ? (
          <EmptyState
            title="Nenhuma carteira vinculada"
            description="Vincule consultoras a um representante para ver a distribuição."
          />
        ) : (
          <ul className="space-y-2">
            {c.por_representante.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ledger-text">{r.representante}</span>
                <span className="shrink-0 text-ledger-muted [font-variant-numeric:tabular-nums]">
                  {formatInt(r.total)} consultoras · {formatInt(r.municipios)} municípios
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Regiões sem cobertura cadastrada" className="lg:col-span-2">
        {c.estados_sem_cobertura.length === 0 ? (
          <p className="text-sm text-ledger-muted">Todos os estados possuem ao menos uma consultora.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {c.estados_sem_cobertura.map((e) => (
              <li
                key={e.uf}
                className="rounded-md border border-line-soft px-2.5 py-1 text-xs text-ledger-muted"
              >
                {e.nome} ({e.uf})
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.08em] text-ledger-muted">{rotulo}</dt>
      <dd className="mt-1 text-2xl font-semibold text-ledger-text [font-variant-numeric:tabular-nums]">
        {formatInt(valor)}
      </dd>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton } from "@/components/admin/ui";
import { registryDuplicates } from "@/lib/registry";

export const Route = createFileRoute("/_authenticated/admin/cadastros/duplicidades")({
  component: Duplicidades,
  head: () => ({
    meta: [
      { title: "Revisão de duplicidades — Central de Cadastros LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Duplicidades() {
  const q = useQuery({ queryKey: ["registry", "duplicates"], queryFn: () => registryDuplicates(100) });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Base operacional · Cadastros"
        title="Possíveis duplicidades"
        description="Nada é unido automaticamente. Aqui apenas apontamos cadastros que parecem ser a mesma pessoa ou empresa, para conferência humana."
      />

      <Panel title="Suspeitas encontradas">
        <div className="p-5">
          {q.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : q.error ? (
            <ErrorState message={q.error instanceof Error ? q.error.message : "Falha ao consultar."} onRetry={() => void q.refetch()} />
          ) : (q.data?.length ?? 0) === 0 ? (
            <EmptyState title="Nenhuma duplicidade" description="Nenhum documento ou contato aparece repetido na base." />
          ) : (
            <ul className="space-y-3">
              {q.data!.map((d) => (
                <li key={`${d.motivo}-${d.chave}`} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                  <p className="ledger-eyebrow">{d.motivo}</p>
                  <p className="num mt-1 text-sm font-semibold text-ledger-text">
                    {d.chave ?? "—"} · {d.quantidade} cadastros
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-3">
                    {d.ids.map((id) => (
                      <li key={id}>
                        <Link to="/admin/cadastros/pessoas/$id" params={{ id }} className="admin-link num text-xs">
                          Abrir ficha {id.slice(0, 8)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}

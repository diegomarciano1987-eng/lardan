/**
 * 0408 — Cadastros incompletos: a mesma regra do card da Central de Cadastros (sem nome, sem CPF/CNPJ ou sem
 * nenhum contato), agora com a lista e o que falta em cada um. Só leitura: corrige-se abrindo a ficha.
 */
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton, formatInt } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/cadastros/incompletos")({
  component: Incompletos,
  head: () => ({
    meta: [
      { title: "Cadastros incompletos — Central de Cadastros LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Item = { id: string; codigo: string | null; tipo: string; nome: string | null; papeis: string | null; faltando: string[] };
const FALTA: Record<string, string> = { nome: "Nome", documento: "CPF/CNPJ", contato: "Telefone ou e-mail" };
const POR_PAGINA = 50;

function Incompletos() {
  const [falta, setFalta] = React.useState<"" | "nome" | "documento" | "contato">("");
  const [pagina, setPagina] = React.useState(0);
  const q = useQuery({
    queryKey: ["registry", "incompletos", falta, pagina],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("registry_incompletos" as never, { _falta: falta || null, _limite: POR_PAGINA, _offset: pagina * POR_PAGINA } as never);
      if (error) throw error;
      return data as unknown as { total: number; itens: Item[] };
    },
  });
  const total = q.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Base operacional · Cadastros"
        title="Cadastros incompletos"
        description="Pessoas e empresas sem nome, sem CPF/CNPJ ou sem nenhum telefone ou e-mail. Abra a ficha para completar."
      />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="O que falta">
        {(["", "documento", "contato", "nome"] as const).map((f) => (
          <button key={f || "todos"} type="button" role="tab" aria-selected={falta === f}
            onClick={() => { setFalta(f); setPagina(0); }}
            className={falta === f ? "admin-btn-primary text-warm-ivory" : "admin-btn"}>
            {f ? `Sem ${FALTA[f]!.toLowerCase()}` : "Todos"}
          </button>
        ))}
      </div>

      <Panel title={q.data ? `${formatInt(total)} cadastro(s)` : "Cadastros"}>
        <div className="p-5">
          {q.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : q.error ? (
            <ErrorState message={q.error instanceof Error ? q.error.message : "Falha ao consultar."} onRetry={() => void q.refetch()} />
          ) : total === 0 ? (
            <EmptyState title="Nada incompleto" description="Todos os cadastros têm nome, documento e ao menos um contato." />
          ) : (
            <>
              <ul className="divide-y divide-line-soft">
                {q.data!.itens.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link to="/admin/cadastros/pessoas/$id" params={{ id: i.id }} className="admin-link text-sm font-semibold">
                        {i.nome ?? "Sem nome"}
                      </Link>
                      <p className="text-xs text-ledger-muted">{[i.codigo, i.papeis].filter(Boolean).join(" · ") || (i.tipo === "organizacao" ? "Empresa" : "Pessoa")}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {i.faltando.map((f) => (
                        <span key={f} className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">Falta {FALTA[f]?.toLowerCase() ?? f}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {paginas > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <button type="button" className="admin-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                  <span className="text-ledger-muted">Página {pagina + 1} de {paginas}</span>
                  <button type="button" className="admin-btn" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
                </div>
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

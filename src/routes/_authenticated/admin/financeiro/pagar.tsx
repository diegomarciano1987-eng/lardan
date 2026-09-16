import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { ListaTitulos } from "@/components/admin/financeiro/ListaTitulos";

interface Busca {
  busca?: string;
  situacao?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/pagar")({
  component: Pagar,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["busca"] === "string" ? { busca: s["busca"] } : {}),
    ...(typeof s["situacao"] === "string" ? { situacao: s["situacao"] } : {}),
  }),
});

function Pagar() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  return (
    <AreaFinanceiraGuard capacidade="finance.payable.view">
      <ListaTitulos
        direction="payable"
        buscaInicial={s.busca ?? ""}
        situacaoInicial={s.situacao ?? "todos"}
        onFiltrosChange={(f) =>
          void navigate({
            to: "/admin/financeiro/pagar",
            search: {
              ...(f.busca ? { busca: f.busca } : {}),
              situacao: f.situacao,
            },
            replace: true,
          })
        }
      />
    </AreaFinanceiraGuard>
  );
}

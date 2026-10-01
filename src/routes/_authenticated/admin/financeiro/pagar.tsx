import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { ListaTitulos } from "@/components/admin/financeiro/ListaTitulos";
import { AlternarVisao, ListaParcelas } from "@/components/admin/financeiro/ListaParcelas";

interface Busca {
  de?: string;
  ate?: string;
  busca?: string;
  situacao?: string;
  visao?: string;
}

export const Route = createFileRoute("/_authenticated/admin/financeiro/pagar")({
  component: Pagar,
  validateSearch: (s: Record<string, unknown>): Busca => ({
    ...(typeof s["de"] === "string" ? { de: s["de"] } : {}),
    ...(typeof s["ate"] === "string" ? { ate: s["ate"] } : {}),
    ...(typeof s["busca"] === "string" ? { busca: s["busca"] } : {}),
    ...(typeof s["situacao"] === "string" ? { situacao: s["situacao"] } : {}),
    ...(s["visao"] === "parcela" ? { visao: "parcela" } : {}),
  }),
});

function Pagar() {
  const navigate = useNavigate();
  const s = Route.useSearch();
  return (
    <AreaFinanceiraGuard capacidade="finance.payable.view">
      <AlternarVisao
        visao={s.visao === "parcela" ? "parcela" : "titulo"}
        onChange={(v) =>
          void navigate({
            to: "/admin/financeiro/pagar",
            search: (prev: Busca): Busca => {
              const { visao: _v, ...resto } = prev;
              return v === "parcela" ? { ...resto, visao: "parcela" } : resto;
            },
            replace: true,
          })
        }
      />
      {s.visao === "parcela" ? <ListaParcelas direction="payable" /> : <ListaTitulos
        direction="payable"
        buscaInicial={s.busca ?? ""}
        situacaoInicial={s.situacao ?? "todos"}
        onFiltrosChange={(f) =>
          void navigate({
            to: "/admin/financeiro/pagar",
            search: (prev: Busca): Busca => {
              const { busca: _anterior, ...resto } = prev;
              return {
                ...resto,
                ...(f.busca ? { busca: f.busca } : {}),
                situacao: f.situacao,
              };
            },
            replace: true,
          })
        }
      />}
    </AreaFinanceiraGuard>
  );
}

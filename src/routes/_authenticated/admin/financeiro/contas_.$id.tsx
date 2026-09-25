import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { ContaCockpit } from "@/components/admin/financeiro/ContaCockpit";

export const Route = createFileRoute("/_authenticated/admin/financeiro/contas_/$id")({
  component: Pagina,
  head: () => ({ meta: [{ title: "Conta — Financeiro Lardan" }] }),
});

function Pagina() {
  const { id } = Route.useParams();
  return (
    <AreaFinanceiraGuard capacidade="finance.bank.view">
      <ContaCockpit id={id} />
    </AreaFinanceiraGuard>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { Conciliacao } from "@/components/admin/financeiro/Conciliacao";

export const Route = createFileRoute("/_authenticated/admin/financeiro/conciliacao")({
  component: ConciliacaoPagina,
});

function ConciliacaoPagina() {
  return (
    <AreaFinanceiraGuard capacidade="finance.statement.view">
      <Conciliacao />
    </AreaFinanceiraGuard>
  );
}

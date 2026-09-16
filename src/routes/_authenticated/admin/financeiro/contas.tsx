import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { ContasCaixas } from "@/components/admin/financeiro/ContasCaixas";

export const Route = createFileRoute("/_authenticated/admin/financeiro/contas")({
  component: Contas,
});

function Contas() {
  return (
    <AreaFinanceiraGuard capacidade="finance.bank.view">
      <ContasCaixas />
    </AreaFinanceiraGuard>
  );
}

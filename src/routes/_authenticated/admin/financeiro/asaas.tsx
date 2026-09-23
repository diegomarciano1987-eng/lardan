import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { AsaasReceber } from "@/components/admin/financeiro/AsaasReceber";

export const Route = createFileRoute("/_authenticated/admin/financeiro/asaas")({
  component: Pagina,
  head: () => ({
    meta: [
      { title: "Recebíveis Asaas — Financeiro LARDAN" },
      { name: "description", content: "Importação de recebíveis, cobranças e conciliação em modo de simulação." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Pagina() {
  return (
    <AreaFinanceiraGuard capacidade="finance.receivable.view">
      <AsaasReceber />
    </AreaFinanceiraGuard>
  );
}

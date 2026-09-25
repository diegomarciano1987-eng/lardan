import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { SaudeAsaas } from "@/components/admin/financeiro/SaudeAsaas";
import { AsaasReceber } from "@/components/admin/financeiro/AsaasReceber";

export const Route = createFileRoute("/_authenticated/admin/financeiro/asaas")({
  component: Pagina,
  head: () => ({
    meta: [
      { title: "Recebíveis Asaas — Financeiro LARDAN" },
      { name: "description", content: "Importação de recebíveis, cobranças e conciliação em produção." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Pagina() {
  return (
    <AreaFinanceiraGuard capacidade="finance.receivable.view">
      <div className="space-y-6">
        <SaudeAsaas />
        <AsaasReceber />
      </div>
    </AreaFinanceiraGuard>
  );
}

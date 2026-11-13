import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { SaudeAsaas } from "@/components/admin/financeiro/SaudeAsaas";
import { AsaasAutomatico } from "@/components/admin/financeiro/AsaasAutomatico";
import { AsaasAutomaticoExtrato } from "@/components/admin/financeiro/AsaasAutomaticoExtrato";
import { AsaasReceber } from "@/components/admin/financeiro/AsaasReceber";
import { MesaAsaas } from "@/components/admin/financeiro/MesaAsaas";
import { AsaasPenteFino } from "@/components/admin/financeiro/AsaasPenteFino";
import { AsaasSaldoEspelho } from "@/components/admin/financeiro/AsaasSaldoEspelho";
import { AsaasEspelhoDiferencas } from "@/components/admin/financeiro/AsaasEspelhoDiferencas";
import { AsaasVariosCadastros } from "@/components/admin/financeiro/AsaasVariosCadastros";
import { ConferenciaSaldoAsaas } from "@/components/admin/financeiro/ConferenciaSaldoAsaas";

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
        <AsaasAutomatico />
        <AsaasAutomaticoExtrato />
        <AsaasEspelhoDiferencas />
        <AsaasSaldoEspelho />
        <AsaasVariosCadastros />
        <AsaasPenteFino />
        <ConferenciaSaldoAsaas />
        <MesaAsaas />
        <AsaasReceber />
      </div>
    </AreaFinanceiraGuard>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { Conciliacao } from "@/components/admin/financeiro/Conciliacao";

export const Route = createFileRoute("/_authenticated/admin/financeiro/conciliacao")({
  head: () => ({ meta: [
    { title: "Conciliação bancária | LARDAN" },
    { name: "description", content: "Conferência de extratos, pagamentos e recebimentos judiciais no financeiro LARDAN." },
    { property: "og:title", content: "Conciliação bancária | LARDAN" },
    { property: "og:description", content: "Conferência de extratos, pagamentos e recebimentos judiciais no financeiro LARDAN." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ConciliacaoPagina,
});

function ConciliacaoPagina() {
  return (
    <AreaFinanceiraGuard capacidade="finance.statement.view">
      <Conciliacao />
    </AreaFinanceiraGuard>
  );
}

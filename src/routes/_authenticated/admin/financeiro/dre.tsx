import { createFileRoute } from "@tanstack/react-router";
import {
  AreaFinanceiraGuard,
  EmImplantacao,
} from "@/components/admin/financeiro/FinanceiroShell";

export const Route = createFileRoute("/_authenticated/admin/financeiro/dre")({
  component: Dre,
});

function Dre() {
  return (
    <AreaFinanceiraGuard capacidade="finance.dre.view">
      <EmImplantacao
        titulo="DRE e relatórios avançados"
        falta={[
          "Plano de contas preenchido e classificando todos os títulos",
          "Definição do regime de apuração (caixa ou competência) com o Daniel",
          "Estrutura de agrupamento por entidade, centro de custo e período",
          "Exportação oficial em formato aprovado",
        ]}
        proximoPasso="Preencher o plano de contas, classificar os títulos existentes e então construir a apuração no servidor, lendo razão e competência."
      />
    </AreaFinanceiraGuard>
  );
}

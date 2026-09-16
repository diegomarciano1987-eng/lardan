import { createFileRoute } from "@tanstack/react-router";
import {
  AreaFinanceiraGuard,
  EmImplantacao,
} from "@/components/admin/financeiro/FinanceiroShell";

export const Route = createFileRoute("/_authenticated/admin/financeiro/importacoes")({
  component: Importacoes,
});

function Importacoes() {
  return (
    <AreaFinanceiraGuard capacidade="finance.view">
      <EmImplantacao
        titulo="Importações financeiras"
        falta={[
          "Modelo oficial de planilha de contas a pagar e a receber, aprovado pelo Daniel",
          "Regras de conferência prévia linha a linha, com recusa de duplicidade",
          "Vínculo automático de contraparte, plano de contas e centro de custo",
          "Promoção dos títulos importados para o motor financeiro já existente",
        ]}
        proximoPasso="Reaproveitar o motor de importação do catálogo (arquivos, jobs, linhas, prévia e promoção) para o domínio financeiro, com validação própria de título e parcela."
      />
    </AreaFinanceiraGuard>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { PartnersPage } from "@/components/admin/PartnersPage";

export const Route = createFileRoute("/_authenticated/admin/cadastros/fornecedores")({
  component: FornecedoresPage,
  head: () => ({
    meta: [
      { title: "Fornecedores — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function FornecedoresPage() {
  return (
    <PartnersPage
      kind="fornecedor"
      eyebrow="Cadastros"
      title="Fornecedores"
      description="Origem das peças. O documento fica protegido e só é revelado sob permissão."
      novoLabel="Novo fornecedor"
      nomeLabel="Razão social / nome"
      docLabel="CNPJ ou CPF"
    />
  );
}

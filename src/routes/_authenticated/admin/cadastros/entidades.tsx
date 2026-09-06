import { createFileRoute } from "@tanstack/react-router";
import { PartnersPage } from "@/components/admin/PartnersPage";

export const Route = createFileRoute("/_authenticated/admin/cadastros/entidades")({
  component: EntidadesPage,
  head: () => ({
    meta: [
      { title: "Entidades de negócio — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function EntidadesPage() {
  return (
    <PartnersPage
      kind="entidade"
      eyebrow="Cadastros"
      title="Entidades de negócio"
      description="Empresas do grupo. O documento fica protegido e só é revelado sob permissão."
      novoLabel="Nova entidade"
      nomeLabel="Razão social"
      docLabel="CNPJ"
    />
  );
}

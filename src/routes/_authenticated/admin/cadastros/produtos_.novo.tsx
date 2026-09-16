import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { ProdutoFicha } from "@/components/admin/ProdutoFicha";

export const Route = createFileRoute("/_authenticated/admin/cadastros/produtos_/novo")({
  component: NovoProduto,
  head: () => ({
    meta: [
      { title: "Novo produto — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

/**
 * Abrir esta página não cria nada no banco: o produto só nasce no primeiro
 * "Salvar rascunho", que já devolve o código interno e leva para a ficha.
 */
function NovoProduto() {
  return (
    <div className="space-y-6">
      <Link to="/admin/cadastros/produtos" className="admin-btn w-fit">
        <ArrowLeft aria-hidden className="size-4" /> Voltar aos produtos
      </Link>
      <ProdutoFicha id={null} />
    </div>
  );
}

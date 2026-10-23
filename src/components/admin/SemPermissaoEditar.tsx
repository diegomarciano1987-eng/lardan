import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/admin/ui";

/** Tela de criação aberta por quem só pode ver: nada de formulário. */
export function SemPermissaoEditar({ voltar, rotulo }: { voltar: "/admin/cadastros/produtos" | "/admin/cadastros/pessoas"; rotulo: string }) {
  return (
    <div className="space-y-6">
      <Link to={voltar} className="admin-btn w-fit">
        <ArrowLeft aria-hidden className="size-4" /> {rotulo}
      </Link>
      <EmptyState
        title="Seu acesso é só para ver"
        description="Para cadastrar ou alterar, o Master precisa liberar “Ver e alterar” neste módulo."
      />
    </div>
  );
}

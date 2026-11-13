import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Panel } from "@/components/admin/ui";
import { DesfazerMovimentos } from "@/components/admin/maletas/DesfazerMovimentos";

export const Route = createFileRoute("/_authenticated/admin/maletas_/movimentos")({
  component: MovimentosPage,
  head: () => ({
    meta: [
      { title: "Movimentos de maleta — Administração LARDAN" },
      { name: "description", content: "Desfazer troca errada de maleta entre consultoras, com motivo e histórico." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function MovimentosPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Núcleo comercial"
        title="Movimentos de maleta"
        description="Trocas de consultora e repasses do representante. Se uma maleta foi para a pessoa errada, desfaça aqui: o movimento de volta fica no histórico com o seu nome e o motivo."
        actions={<Link to="/admin/maletas" className="admin-btn"><ArrowLeft aria-hidden className="size-4" /> Remessas</Link>}
      />
      <Panel title="Últimos 120 dias">
        <DesfazerMovimentos />
      </Panel>
    </div>
  );
}

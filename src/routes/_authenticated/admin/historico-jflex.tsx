import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, PageHeader } from "@/components/admin/ui";
import { HistoricoJFlexImportacao } from "@/components/admin/historico/HistoricoJFlex";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { hasAny } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/admin/historico-jflex")({
  component: HistoricoJFlexPage,
  head: () => ({
    meta: [
      { title: "Histórico JFLEX — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function HistoricoJFlexPage() {
  const roles = useAdminRoles();
  const ehMaster = hasAny(roles, ["master"]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Configurações · Histórico"
        title="Histórico JFLEX"
        description="Importação e leitura do histórico antigo da rede. O histórico é só leitura: nenhuma tela grava em maletas, estoque, pedidos, financeiro ou fiscal."
      />
      {ehMaster ? (
        <HistoricoJFlexImportacao ehMaster={ehMaster} />
      ) : (
        <EmptyState
          title="Acesso restrito ao Master"
          description="Só o Master importa os arquivos e vê esta tela. As leituras do histórico aparecem nas fichas, no cockpit de remessas e na rede."
        />
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ADMIN_SUBMODULES } from "@/lib/admin-modules";
import { useAdminRoles } from "@/components/admin/AdminShell";
import { hasAny } from "@/lib/session";
import { ModuleAvailabilityBadge, PageHeader, Panel } from "@/components/admin/ui";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: Configuracoes,
  head: () => ({
    meta: [
      { title: "Configurações — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Configuracoes() {
  const roles = useAdminRoles();
  const itens = ADMIN_SUBMODULES.filter((m) => hasAny(roles, m.roles));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="GOVERNANÇA"
        title="Configurações"
        description="Usuários e papéis, integrações e parâmetros do sistema."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {itens.map((m) => (
          <Panel key={m.slug}>
            <div className="space-y-3 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg text-ledger-text">{m.label}</h2>
                <ModuleAvailabilityBadge state={m.state} />
              </div>
              <p className="text-sm text-ledger-muted">{m.description}</p>
              {m.path && (
                <Link to={m.path} className="admin-link">
                  Abrir
                </Link>
              )}
            </div>
          </Panel>
        ))}
        {itens.length === 0 && (
          <p className="text-sm text-ledger-muted">
            O seu perfil não tem acesso a nenhuma configuração.
          </p>
        )}
      </div>
    </div>
  );
}

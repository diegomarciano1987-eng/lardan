import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { fetchMyRoles } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
  head: () => ({
    meta: [
      { title: "Administração — LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminLayout() {
  const { user } = Route.useRouteContext();
  const { data: roles, isLoading } = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  if (isLoading) return null;
  if (!portaLiberada("operacao", roles ?? [])) {
    // Quem não é da operação vai direto para a própria área, sem tela de bloqueio.
    if (portaLiberada("representante", roles ?? [])) return <Navigate to="/representante" replace />;
    if (portaLiberada("consultora", roles ?? [])) return <Navigate to="/consultora" replace />;
    return <AcessoNaoLiberado />;
  }
  return (
    <AdminShell email={user?.email}>
      <Outlet />
    </AdminShell>
  );
}

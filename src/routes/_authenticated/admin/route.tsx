import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { fetchMyRoles } from "@/lib/session";
import { inicioOperacao, portaLiberada, soModulos } from "@/lib/portas";
import { fetchMyCapabilities, fetchSouColab } from "@/lib/capabilities";

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
  const capsQ = useQuery({ queryKey: ["my-capabilities"], queryFn: fetchMyCapabilities });
  const colabQ = useQuery({ queryKey: ["sou-colab"], queryFn: fetchSouColab });
  const { pathname } = useLocation();
  if (isLoading || capsQ.isLoading || colabQ.isLoading) return null;
  if (!portaLiberada("operacao", roles ?? [], capsQ.data ?? [], colabQ.data === true)) {
    // Quem não é da operação vai direto para a própria área, sem tela de bloqueio.
    if (portaLiberada("representante", roles ?? [])) return <Navigate to="/representante" replace />;
    if (portaLiberada("consultora", roles ?? [])) return <Navigate to="/consultora" replace />;
    return <AcessoNaoLiberado />;
  }
  // Colaboradora por código nunca vê o painel geral (Inteligência Operacional).
  if (soModulos(roles ?? []) && (pathname === "/admin" || pathname === "/admin/")) {
    return <Navigate to={inicioOperacao(roles ?? [], capsQ.data ?? []) as never} replace />;
  }
  return (
    <AdminShell email={user?.email}>
      <Outlet />
    </AdminShell>
  );
}

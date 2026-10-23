import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { fetchMyRoles } from "@/lib/session";
import { inicioOperacao, portaLiberada, soModulos } from "@/lib/portas";
import { fetchMyCapabilities, fetchSouColab } from "@/lib/capabilities";
import { ALL_MODULES, moduleAllowed } from "@/lib/admin-modules";

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
  if (capsQ.isError || colabQ.isError) return <AcessoNaoLiberado />;
  if (!portaLiberada("operacao", roles ?? [], capsQ.data ?? [], colabQ.data === true)) {
    // Quem não é da operação vai direto para a própria área, sem tela de bloqueio.
    if (portaLiberada("representante", roles ?? [])) return <Navigate to="/representante" replace />;
    if (portaLiberada("consultora", roles ?? [])) return <Navigate to="/consultora" replace />;
    return <AcessoNaoLiberado />;
  }
  // Login continua abrindo Maletas; /admin oferece apenas o resumo pessoal à colaboradora.
  if (colabQ.data !== true && soModulos(roles ?? []) && (pathname === "/admin" || pathname === "/admin/")) {
    return <Navigate to={inicioOperacao(roles ?? [], capsQ.data ?? []) as never} replace />;
  }
  if (colabQ.data === true) {
    if (pathname === "/admin/cadastros" || pathname === "/admin/cadastros/") return <Navigate to="/admin/cadastros/pessoas" search={{ papel: "consultora" }} replace />;
    if (pathname.startsWith("/admin/estoque") ||
      (pathname.startsWith("/admin/cadastros/") && !pathname.startsWith("/admin/cadastros/pessoas") && !pathname.startsWith("/admin/cadastros/produtos"))) return <AcessoNaoLiberado />;
    const mod = [...ALL_MODULES].filter((m) => m.path && m.path !== "/admin" && pathname.startsWith(m.path)).sort((a,b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
    if (mod && !moduleAllowed(mod, capsQ.data ?? [], roles ?? [])) return <AcessoNaoLiberado />;
    if (pathname.endsWith("/novo") && !capsQ.data?.includes(pathname.includes("/produtos") ? "product.manage" : "registry.manage")) return <AcessoNaoLiberado />;
  }
  return (
    <AdminShell email={user?.email}>
      <Outlet />
    </AdminShell>
  );
}

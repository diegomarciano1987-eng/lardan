import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { ConexaoInstavel } from "@/components/site/ConexaoInstavel";
import { estadoPermissao } from "@/lib/sessao-regras";
import { fetchMyRoles } from "@/lib/session";
import { caminhoLiberadoJuridico, inicioOperacao, portaLiberada, somenteLeituraCobranca, soModulos } from "@/lib/portas";
import { fetchMyCapabilities, fetchSouColabEstrito } from "@/lib/capabilities";
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
  const rolesQ = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles, staleTime: 10 * 60_000 });
  const roles = rolesQ.data;
  const capsQ = useQuery({ queryKey: ["my-capabilities"], queryFn: fetchMyCapabilities, staleTime: 10 * 60_000 });
  const colabQ = useQuery({ queryKey: ["sou-colab"], queryFn: fetchSouColabEstrito, staleTime: 10 * 60_000 });
  const { pathname } = useLocation();
  // 0358: releitura que falhe mantém a última resposta boa; falha de rede nunca vira "acesso não liberado".
  const estado = estadoPermissao([rolesQ, capsQ, colabQ]);
  if (estado === "carregando") return null;
  if (estado === "instavel") {
    return <ConexaoInstavel onTentar={() => { void rolesQ.refetch(); void capsQ.refetch(); void colabQ.refetch(); }} />;
  }
  if (!portaLiberada("operacao", roles ?? [], capsQ.data ?? [], colabQ.data === true)) {
    // Quem não é da operação vai direto para a própria área, sem tela de bloqueio.
    if (portaLiberada("representante", roles ?? [])) return <Navigate to="/representante" replace />;
    if (portaLiberada("consultora", roles ?? [])) return <Navigate to="/consultora" replace />;
    return <AcessoNaoLiberado />;
  }
  // Jurídico: só a Cobrança (carteira e ficha), sem nenhum outro módulo.
  if (colabQ.data !== true && somenteLeituraCobranca(roles ?? []) && !caminhoLiberadoJuridico(pathname)) {
    return <Navigate to="/admin/cobranca" replace />;
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

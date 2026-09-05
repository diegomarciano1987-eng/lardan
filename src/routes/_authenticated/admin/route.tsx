import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";

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
  return (
    <AdminShell email={user?.email}>
      <Outlet />
    </AdminShell>
  );
}

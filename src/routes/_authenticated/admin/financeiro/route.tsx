import { Outlet, createFileRoute } from "@tanstack/react-router";
import { FinanceiroShell } from "@/components/admin/financeiro/FinanceiroShell";

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  component: FinanceiroLayout,
  head: () => ({
    meta: [
      { title: "Financeiro — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function FinanceiroLayout() {
  return (
    <FinanceiroShell>
      <Outlet />
    </FinanceiroShell>
  );
}

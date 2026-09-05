import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  component: () => <ModulePlaceholder slug="estoque" />,
  head: () => ({
    meta: [
      { title: "Estoque — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/cadastros")({
  component: () => <ModulePlaceholder slug="cadastros" />,
  head: () => ({
    meta: [
      { title: "Cadastros — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

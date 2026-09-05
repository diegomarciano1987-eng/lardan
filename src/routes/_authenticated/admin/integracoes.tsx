import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/integracoes")({
  component: () => <ModulePlaceholder slug="integracoes" />,
  head: () => ({
    meta: [
      { title: "Integrações — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

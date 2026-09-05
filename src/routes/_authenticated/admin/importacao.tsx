import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/importacao")({
  component: () => <ModulePlaceholder slug="importacao" />,
  head: () => ({
    meta: [
      { title: "Importação — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

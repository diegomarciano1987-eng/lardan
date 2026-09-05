import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/admin/AdminShell";

export const Route = createFileRoute("/_authenticated/admin/site")({
  component: () => <ModulePlaceholder slug="site" />,
  head: () => ({
    meta: [
      { title: "Site — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

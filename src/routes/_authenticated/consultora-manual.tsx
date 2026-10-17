import { createFileRoute } from "@tanstack/react-router";
import { FolhaA4, ModoDeUso } from "@/components/consultora/DocumentoLardan";

export const Route = createFileRoute("/_authenticated/consultora-manual")({
  component: () => <FolhaA4 titulo="Manual de uso e cuidados"><ModoDeUso /></FolhaA4>,
  head: () => ({
    meta: [
      { title: "Manual de uso e cuidados — LARDAN" },
      { name: "description", content: "Modo de uso das semijoias LARDAN para manter a garantia." },
      { property: "og:title", content: "Manual de uso e cuidados — LARDAN" },
      { property: "og:description", content: "Como usar e conservar suas semijoias LARDAN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import { ogImageMeta } from "@/lib/seo";

export const Route = createFileRoute("/colecoes")({
  component: ColecoesPage,
  head: () => ({
    meta: [
      { title: "Coleção — LARDAN" },
      { name: "description", content: "Coleções de semijoias Lardan." },
      { property: "og:title", content: "Coleção — LARDAN" },
      { property: "og:description", content: "Coleções de semijoias Lardan." },
      { property: "og:url", content: "/colecoes" },
          ...ogImageMeta(),
],
    links: [{ rel: "canonical", href: "/colecoes" }],
  }),
});

function ColecoesPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Editorial" title="Coleção" />
      <PendingNote text="A primeira coleção publicada pela equipe Lardan aparecerá aqui, com curadoria editorial e produtos reais." />
    </SiteLayout>
  );
}

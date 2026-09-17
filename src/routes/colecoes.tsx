import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import { canonical, jsonLdScript, pageMeta, webPageLd } from "@/lib/seo";

const TITULO = "Coleção — LARDAN";
const DESCRICAO = "Coleções de semijoias Lardan.";

export const Route = createFileRoute("/colecoes")({
  component: ColecoesPage,
  head: () => ({
    meta: [
      ...pageMeta({ title: TITULO, description: DESCRICAO, path: "/colecoes" }),
      // Nenhuma coleção publicada ainda: a página permanece no site e no menu,
      // mas não é enviada para indexação (evita soft 404).
      { name: "robots", content: "noindex, follow" },
    ],
    links: canonical("/colecoes"),
    scripts: [
      jsonLdScript(webPageLd({ path: "/colecoes", name: TITULO, description: DESCRICAO })),
    ],
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

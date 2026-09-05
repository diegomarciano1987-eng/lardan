import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import colaresAsset from "@/assets/lardan-categoria-colares.jpg.asset.json";

export const Route = createFileRoute("/semijoias/colares")({
  component: ColaresPage,
  head: () => ({
    meta: [
      { title: "Colares — Semijoias LARDAN" },
      { name: "description", content: "Colares de semijoias Lardan. Coleção em publicação." },
      { property: "og:title", content: "Colares — Semijoias LARDAN" },
      { property: "og:description", content: "Colares de semijoias Lardan." },
      { property: "og:url", content: "/semijoias/colares" },
    ],
    links: [{ rel: "canonical", href: "/semijoias/colares" }],
  }),
});

function ColaresPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Semijoias" title="Colares" />
      <section className="mx-auto max-w-4xl px-6 pb-10">
        <img
          src={colaresAsset.url}
          alt="Colar de semijoia sobre formas de vidro"
          width={1664}
          height={928}
          className="aspect-[16/9] w-full rounded-2xl object-cover"
          style={{ boxShadow: "var(--shadow-soft)" }}
        />
      </section>
      <PendingNote text="Os produtos desta categoria estão sendo cadastrados pela equipe Lardan e aparecem aqui assim que forem publicados." />
    </SiteLayout>
  );
}

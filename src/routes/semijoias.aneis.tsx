import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import aneisAsset from "@/assets/lardan-categoria-aneis.jpg.asset.json";

export const Route = createFileRoute("/semijoias/aneis")({
  component: AneisPage,
  head: () => ({
    meta: [
      { title: "Anéis — Semijoias LARDAN" },
      { name: "description", content: "Anéis de semijoias Lardan. Coleção em publicação." },
      { property: "og:title", content: "Anéis — Semijoias LARDAN" },
      { property: "og:description", content: "Anéis de semijoias Lardan." },
      { property: "og:url", content: "/semijoias/aneis" },
    ],
    links: [{ rel: "canonical", href: "/semijoias/aneis" }],
  }),
});

function AneisPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Semijoias" title="Anéis" />
      <section className="mx-auto max-w-4xl px-6 pb-10">
        <img
          src={aneisAsset.url}
          alt="Anel de semijoia sobre onda de vidro transparente"
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

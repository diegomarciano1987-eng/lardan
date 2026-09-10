import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import editorialAsset from "@/assets/lardan-editorial-mulher.jpg.asset.json";
import { ogImageMeta } from "@/lib/seo";

export const Route = createFileRoute("/a-lardan")({
  component: ALardanPage,
  head: () => ({
    meta: [
      { title: "A Lardan — a marca" },
      { name: "description", content: "Conheça a Lardan: marca de semijoias criada para acompanhar os seus momentos." },
      { property: "og:title", content: "A Lardan — a marca" },
      { property: "og:description", content: "Conheça a marca de semijoias Lardan." },
      { property: "og:url", content: "/a-lardan" },
      ...ogImageMeta(),
    ],
    links: [{ rel: "canonical", href: "/a-lardan" }],
  }),
});

function ALardanPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="A marca" title="A Lardan">
        <p>
          Uma marca de semijoias dedicada a peças que acompanham os seus
          momentos.
        </p>
      </PageHero>
      <section className="mx-auto max-w-4xl px-6 pb-10">
        <img
          src={editorialAsset.url}
          alt="Editorial Lardan com semijoias em ambiente de vidro e luz marfim"
          loading="lazy"
          width={1664}
          height={928}
          className="aspect-[16/9] w-full rounded-2xl object-cover"
          style={{ boxShadow: "var(--shadow-soft)" }}
        />
      </section>
      <PendingNote text="A história completa da marca está em revisão editorial e será publicada após aprovação. Nenhum dado institucional provisório é exibido aqui." />
    </SiteLayout>
  );
}

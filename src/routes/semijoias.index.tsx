import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import aneisAsset from "@/assets/lardan-categoria-aneis.jpg.asset.json";
import colaresAsset from "@/assets/lardan-categoria-colares.jpg.asset.json";

export const Route = createFileRoute("/semijoias")({
  component: SemijoiasPage,
  head: () => ({
    meta: [
      { title: "Semijoias — LARDAN" },
      { name: "description", content: "Catálogo de semijoias Lardan por categoria: anéis, colares, pulseiras e brincos." },
      { property: "og:title", content: "Semijoias — LARDAN" },
      { property: "og:description", content: "Catálogo de semijoias Lardan por categoria." },
      { property: "og:url", content: "/semijoias" },
    ],
    links: [{ rel: "canonical", href: "/semijoias" }],
  }),
});

const CATEGORIES = [
  { title: "Anéis", to: "/semijoias/aneis", image: aneisAsset, alt: "Anel de semijoia sobre onda de vidro" },
  { title: "Colares", to: "/semijoias/colares", image: colaresAsset, alt: "Colar de semijoia sobre formas de vidro" },
] as const;

function SemijoiasPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Catálogo" title="Semijoias">
        <p>
          O catálogo completo, com busca e filtros, será publicado junto com os
          produtos reais da coleção. Explore as categorias disponíveis.
        </p>
      </PageHero>
      <section className="mx-auto grid max-w-5xl gap-8 px-6 pb-24 md:grid-cols-2">
        {CATEGORIES.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="group overflow-hidden rounded-2xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <img
              src={c.image.url}
              alt={c.alt}
              loading="lazy"
              width={1664}
              height={928}
              className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="flex items-center justify-between p-5">
              <span className="font-display text-2xl text-foreground">{c.title}</span>
              <span className="text-[0.6875rem] tracking-[0.22em] uppercase text-muted-foreground">
                Ver categoria
              </span>
            </div>
          </Link>
        ))}
      </section>
    </SiteLayout>
  );
}

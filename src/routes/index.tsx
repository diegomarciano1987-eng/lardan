import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { HeroScroll } from "@/components/site/HeroScroll";
import { SessaoSemijoias } from "@/components/site/SessaoSemijoias";
import { CategoryGuillotine } from "@/components/site/CategoryGuillotine";
import aneisAsset from "@/assets/lardan-categoria-aneis.jpg.asset.json";
import colaresAsset from "@/assets/lardan-categoria-colares.jpg.asset.json";
import pulseirasAsset from "@/assets/lardan-categoria-pulseiras.png.asset.json";
import brincosAsset from "@/assets/lardan-categoria-brincos.png.asset.json";
import aneisMobileAsset from "@/assets/lardan-mobile-aneis.png.asset.json";
import pulseirasMobileAsset from "@/assets/lardan-mobile-pulseiras.png.asset.json";
import brincosMobileAsset from "@/assets/lardan-mobile-brincos.png.asset.json";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "LARDAN — Semijoias | Única. Como cada história." },
      {
        name: "description",
        content:
          "Semijoias Lardan: anéis, colares, pulseiras e brincos para acompanhar os seus momentos. Conheça a marca e a coleção.",
      },
      { property: "og:title", content: "LARDAN — Semijoias" },
      {
        property: "og:description",
        content: "Semijoias para acompanhar os seus momentos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
});

function HomePage() {
  return (
    <SiteLayout>
      <HeroScroll />
      <SessaoSemijoias />

      <CategoryGuillotine
        title="Anéis"
        to="/semijoias/aneis"
        image={aneisAsset}
        mobileImage={aneisMobileAsset}
        imageAlt="Anel de semijoia Lardan sobre onda de vidro transparente"
        enterFrom="right"
        align="left"
      />
      <CategoryGuillotine
        title="Colares"
        to="/semijoias/colares"
        image={colaresAsset}
        imageAlt="Colar de semijoia Lardan sobre formas de vidro"
        enterFrom="left"
        align="left"
      />
      <CategoryGuillotine
        title="Pulseiras"
        to="/semijoias"
        image={pulseirasAsset}
        mobileImage={pulseirasMobileAsset}
        imageAlt="Pulseira Lardan em ouro rosé sobre onda de vidro"
        enterFrom="right"
        align="right"
      />
      <CategoryGuillotine
        title="Brincos"
        to="/semijoias"
        image={brincosAsset}
        mobileImage={brincosMobileAsset}
        imageAlt="Brinco Lardan em ouro rosé sobre base de vidro"
        enterFrom="left"
        align="left"
      />

      {/* Convite Seja Lardan */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="brand-eyebrow mb-3">Seja Lardan</p>
          <h2 className="text-4xl text-foreground md:text-5xl">
            Construa a sua história com a Lardan
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
            Candidate-se para conhecer a proposta de parceria da marca. Sem
            promessa de renda garantida: cada candidatura passa por análise.
          </p>
          <Link
            to="/seja-lardan"
            className="mt-10 inline-flex items-center border-b border-primary/50 pb-2 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Quero me candidatar
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}

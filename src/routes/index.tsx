import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { HeroScroll } from "@/components/site/HeroScroll";
import { SessaoSemijoias } from "@/components/site/SessaoSemijoias";
import { CategoryGuillotine } from "@/components/site/CategoryGuillotine";
import { getHomeConfig, listPublicCategories } from "@/lib/storefront";
import aneisAsset from "@/assets/lardan-categoria-aneis.jpg.asset.json";
import colaresAsset from "@/assets/lardan-categoria-colares.jpg.asset.json";
import pulseirasFundoAsset from "@/assets/lardan-pulseiras-fundo-novo.jpg.asset.json";
import brincosFundoAsset from "@/assets/lardan-brincos-fundo-novo.jpg.asset.json";
import aneisMobileAsset from "@/assets/lardan-mobile-aneis.png.asset.json";
import colaresMobileAsset from "@/assets/sessao_colares_mobile.png.asset.json";
import pulseirasMobileAsset from "@/assets/lardan-mobile-pulseiras.png.asset.json";
import brincosMobileAsset from "@/assets/lardan-mobile-brincos.png.asset.json";

/** Cenas aprovadas da página inicial — o desenho não muda, só a curadoria. */
const CENAS = [
  {
    categoria: "aneis",
    title: "Anéis",
    image: aneisAsset,
    imageWebp: "/img/lardan-categoria-aneis.webp",
    mobileImage: aneisMobileAsset,
    mobileImageWebp: "/img/lardan-mobile-aneis.webp",
    imageAlt: "Anel de semijoia Lardan sobre onda de vidro transparente",
    align: "left" as const,
  },
  {
    categoria: "colares",
    title: "Colares",
    image: colaresAsset,
    imageWebp: "/img/lardan-categoria-colares.webp",
    mobileImage: colaresMobileAsset,
    mobileImageWebp: "/img/sessao_colares_mobile.webp",
    imageAlt: "Colar de semijoia Lardan sobre formas de vidro",
    align: "left" as const,
  },
  {
    categoria: "pulseiras",
    title: "Pulseiras",
    subtitle: "braceletes",
    image: pulseirasFundoAsset,
    imageWebp: "/img/lardan-pulseiras-fundo-novo.webp",
    mobileImage: pulseirasMobileAsset,
    mobileImageWebp: "/img/lardan-mobile-pulseiras.webp",
    imageAlt: "Pulseiras e bracelete Lardan em ouro sobre bandeja de vidro",
    align: "right" as const,
  },
  {
    categoria: "brincos",
    title: "Brincos",
    image: brincosFundoAsset,
    imageWebp: "/img/lardan-brincos-fundo-novo.webp",
    mobileImage: brincosMobileAsset,
    mobileImageWebp: "/img/lardan-mobile-brincos.webp",
    imageAlt: "Brincos Lardan em ouro com brilhantes sobre onda de vidro",
    align: "right" as const,
    mobileAlign: "left" as const,
  },
];

export const Route = createFileRoute("/")({
  component: HomePage,
  // A home lê a curadoria vigente; falha de leitura não derruba o design aprovado.
  loader: async () => {
    try {
      const [config, categorias] = await Promise.all([getHomeConfig(), listPublicCategories()]);
      return { config, categorias };
    } catch {
      return { config: null, categorias: [] };
    }
  },
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
  errorComponent: () => (
    <SiteLayout>
      <HeroScroll />
      <SessaoSemijoias />
    </SiteLayout>
  ),
});

function HomePage() {
  const { config, categorias } = Route.useLoaderData();

  const publicadas = new Map(categorias.map((c) => [c.slug, c]));
  const bloco = (config ?? []).find((b) => b.chave === "categorias");

  // Curadoria vazia ou ausente → fallback editorial aprovado (as quatro cenas).
  let cenas = CENAS;
  if (bloco && bloco.visivel === false) {
    cenas = [];
  } else if (bloco && bloco.itens.length > 0) {
    const escolhidos = bloco.itens
      .map((id) => categorias.find((c) => c.id === id)?.slug)
      .filter((slug): slug is string => Boolean(slug));
    const ordenadas = escolhidos
      .map((slug) => CENAS.find((c) => c.categoria === slug))
      .filter((c): c is (typeof CENAS)[number] => Boolean(c));
    if (ordenadas.length > 0) cenas = ordenadas;
  }

  return (
    <SiteLayout>
      <HeroScroll />
      <SessaoSemijoias />

      {cenas.map((cena, i) => (
        <CategoryGuillotine
          key={cena.categoria}
          title={cena.title}
          {...(cena.subtitle ? { subtitle: cena.subtitle } : {})}
          categoria={cena.categoria}
          image={cena.image}
          imageWebp={cena.imageWebp}
          mobileImage={cena.mobileImage}
          mobileImageWebp={cena.mobileImageWebp}
          imageAlt={cena.imageAlt}
          enterFrom={i % 2 === 0 ? "right" : "left"}
          align={cena.align}
          {...(cena.mobileAlign ? { mobileAlign: cena.mobileAlign } : {})}
          disponivel={publicadas.has(cena.categoria)}
        />
      ))}

      {/* Convite Seja Lardan */}
      <section className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="brand-eyebrow mb-3">Seja Lardan</p>
          <h2 className="text-4xl text-foreground md:text-5xl">
            Construa a sua história com a Lardan
          </h2>
          <p className="mx-auto mt-4 max-w-md text-base text-muted-foreground">
            Candidate-se para conhecer a proposta de parceria da marca. Sem promessa de renda
            garantida: cada candidatura passa por análise.
          </p>
          <Link to="/seja-lardan" className="btn-premium mt-10">
            Quero me candidatar
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}

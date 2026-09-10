import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { ProductGrid, StateNote } from "@/components/site/ProductGrid";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront";
import { ogImageMeta } from "@/lib/seo";

const POR_PAGINA = 12;

export const Route = createFileRoute("/semijoias/")({
  component: SemijoiasPage,
  head: () => ({
    meta: [
      { title: "Semijoias — LARDAN" },
      { name: "description", content: "Catálogo de semijoias Lardan por categoria: anéis, colares, pulseiras e brincos." },
      { property: "og:title", content: "Semijoias — LARDAN" },
      { property: "og:description", content: "Catálogo de semijoias Lardan por categoria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
          ...ogImageMeta(),
],
    links: [{ rel: "canonical", href: "/semijoias" }],
  }),
});

function SemijoiasPage() {
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(texto.trim());
      setPagina(0);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const categorias = useQuery({ queryKey: ["categorias-publicas"], queryFn: listPublicCategories });

  const produtos = useQuery({
    queryKey: ["vitrine", "todas", busca, pagina],
    queryFn: () => listPublicProducts({ busca: busca || null, pagina, porPagina: POR_PAGINA }),
    placeholderData: keepPreviousData,
  });

  const total = produtos.data?.total ?? 0;
  const carregados = (pagina + 1) * POR_PAGINA;

  return (
    <SiteLayout>
      <PageHero eyebrow="Catálogo" title="Semijoias">
        <p>Peças publicadas pela Lardan, sempre com informações reais de catálogo.</p>
      </PageHero>

      <section className="mx-auto max-w-6xl px-6 pb-8">
        <label className="sr-only" htmlFor="busca-semijoias">
          Buscar peças
        </label>
        <input
          id="busca-semijoias"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nome ou descrição da peça"
          className="w-full rounded-full border border-border bg-card px-6 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />

        {(categorias.data?.length ?? 0) > 0 ? (
          <ul className="mt-6 flex flex-wrap gap-3">
            {categorias.data?.map((c) => (
              <li key={c.id}>
                <Link
                  to="/semijoias/$categoria"
                  params={{ categoria: c.slug }}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm text-foreground transition-colors hover:bg-card"
                >
                  {c.name}
                  <span className="text-muted-foreground">{c.produtos}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        {produtos.isLoading ? (
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : produtos.error ? (
          <StateNote text="Não conseguimos carregar as peças agora. Tente novamente em instantes." />
        ) : total === 0 ? (
          <StateNote
            text={
              busca
                ? "Nenhuma peça publicada corresponde a esta busca."
                : "Nenhuma peça publicada ainda. Assim que o catálogo for publicado no sistema, ele aparece aqui."
            }
          />
        ) : (
          <>
            <ProductGrid produtos={produtos.data?.rows ?? []} />
            {carregados < total ? (
              <div className="mt-12 flex justify-center">
                <button type="button" className="btn-premium" onClick={() => setPagina((p) => p + 1)}>
                  Ver mais peças
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </SiteLayout>
  );
}

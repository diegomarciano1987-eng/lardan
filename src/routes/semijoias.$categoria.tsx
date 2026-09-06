import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { ProductGrid, StateNote } from "@/components/site/ProductGrid";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront";

const POR_PAGINA = 12;

export const Route = createFileRoute("/semijoias/$categoria")({
  component: CategoriaPage,
  head: ({ params }) => {
    const nome = params.categoria.charAt(0).toUpperCase() + params.categoria.slice(1);
    return {
      meta: [
        { title: `${nome} — Semijoias LARDAN` },
        { name: "description", content: `Peças de ${nome.toLowerCase()} publicadas no catálogo oficial Lardan.` },
        { property: "og:title", content: `${nome} — Semijoias LARDAN` },
        { property: "og:description", content: `Peças de ${nome.toLowerCase()} do catálogo Lardan.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: `/semijoias/${params.categoria}` }],
    };
  },
});

function CategoriaPage() {
  const { categoria } = Route.useParams();
  const [pagina, setPagina] = useState(0);

  const categorias = useQuery({ queryKey: ["categorias-publicas"], queryFn: listPublicCategories });
  const atual = categorias.data?.find((c) => c.slug === categoria);

  const produtos = useQuery({
    queryKey: ["vitrine", categoria, pagina],
    queryFn: () => listPublicProducts({ categoria, pagina, porPagina: POR_PAGINA }),
    placeholderData: keepPreviousData,
  });

  const total = produtos.data?.total ?? 0;
  const carregados = (pagina + 1) * POR_PAGINA;

  return (
    <SiteLayout>
      <PageHero eyebrow="Semijoias" title={atual?.name ?? "Categoria"}>
        {atual?.description ? <p>{atual.description}</p> : null}
      </PageHero>

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
          <StateNote text="Nenhuma peça publicada nesta categoria por enquanto." />
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

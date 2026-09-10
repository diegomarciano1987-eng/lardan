import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { StateNote } from "@/components/site/ProductGrid";
import { CompraProduto } from "@/components/site/CompraProduto";
import { formatPreco, getPublicProduct, mediaUrl } from "@/lib/storefront";
import { ogImageMeta } from "@/lib/seo";

export const Route = createFileRoute("/produto/$slug")({
  component: ProdutoPage,
  // Peça inexistente, em rascunho, arquivada ou fora do ar responde 404 de verdade.
  loader: async ({ params }) => {
    const peca = await getPublicProduct(params.slug);
    if (!peca) throw notFound();
    return { peca };
  },
  head: ({ params, loaderData }) => {
    const p = loaderData?.peca ?? null;
    const titulo = p?.seo_title?.trim() || (p ? `${p.name} — Semijoias LARDAN` : "Peça indisponível — LARDAN");
    const descricao =
      p?.seo_description?.trim() ||
      p?.short_description?.trim() ||
      "Peça de semijoia Lardan publicada no catálogo oficial.";
    return {
      meta: [
        { title: titulo },
        { name: "description", content: descricao },
        ...(p ? [] : [{ name: "robots", content: "noindex" }]),
        { property: "og:title", content: titulo },
        { property: "og:description", content: descricao },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
        ...ogImageMeta(p?.imagens?.[0] ? mediaUrl(p.imagens[0].media_id) : null),
      ],
      links: [{ rel: "canonical", href: `/produto/${params.slug}` }],
    };
  },
  errorComponent: () => (
    <SiteLayout brandedHeader>
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-36">
        <StateNote text="Não conseguimos carregar esta peça agora. Tente novamente em instantes." />
      </div>
    </SiteLayout>
  ),
  notFoundComponent: () => (
    <SiteLayout brandedHeader>
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-36">
        <StateNote text="Esta peça não está disponível no catálogo." />
      </div>
    </SiteLayout>
  ),
});

function ProdutoPage() {
  const { peca: p } = Route.useLoaderData();

  const preco = formatPreco(p.price_cents);

  return (
    <SiteLayout brandedHeader>
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-36 md:pt-44">
        <nav className="mb-8 text-xs uppercase tracking-[0.22em] text-muted-foreground">
          <Link to="/semijoias">Semijoias</Link>
          {p.category ? (
            <>
              {" / "}
              <Link to="/semijoias/$categoria" params={{ categoria: p.category.slug }}>
                {p.category.name}
              </Link>
            </>
          ) : null}
        </nav>

        <div className="grid gap-12 md:grid-cols-2">
          <div className="space-y-4">
            {p.imagens.length === 0 ? (
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">
                Sem foto publicada
              </div>
            ) : (
              p.imagens.map((img) => (
                <img
                  key={img.media_id}
                  src={mediaUrl(img.media_id) ?? ""}
                  alt={img.alt}
                  loading="lazy"
                  className="w-full rounded-2xl object-cover"
                />
              ))
            )}
          </div>

          <div>
            <h1 className="font-display text-4xl text-foreground md:text-5xl">{p.name}</h1>
            {p.short_description ? (
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">{p.short_description}</p>
            ) : null}
            <p className="mt-6 text-2xl text-foreground">{preco ?? "Consulte sua consultora"}</p>

            <CompraProduto
              slug={p.slug}
              nome={p.name}
              precoCents={p.price_cents}
              mediaId={p.imagens[0]?.media_id ?? null}
              variantes={p.variantes.map((v) => ({ id: v.id, label: v.label }))}
            />

            {p.description ? (
              <p className="mt-8 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {p.description}
              </p>
            ) : null}

            <dl className="mt-8 space-y-2 text-sm">
              <Linha rotulo="Material" valor={p.material} />
              <Linha rotulo="Banho" valor={p.plating} />
              <Linha rotulo="Medidas" valor={p.measurements} />
              <Linha rotulo="Cuidados" valor={p.care_instructions} />
              <Linha rotulo="Garantia" valor={p.warranty_text} />
            </dl>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex gap-3 border-b border-border pb-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="text-foreground">{valor}</dd>
    </div>
  );
}

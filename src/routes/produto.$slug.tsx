import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { StateNote } from "@/components/site/ProductGrid";
import { formatPreco, getPublicProduct, mediaUrl } from "@/lib/storefront";

export const Route = createFileRoute("/produto/$slug")({
  component: ProdutoPage,
  head: ({ params }) => ({
    meta: [
      { title: `Peça ${params.slug} — Semijoias LARDAN` },
      { name: "description", content: "Peça de semijoia Lardan publicada no catálogo oficial." },
      { property: "og:title", content: `Peça ${params.slug} — Semijoias LARDAN` },
      { property: "og:description", content: "Peça de semijoia Lardan publicada no catálogo oficial." },
      { property: "og:type", content: "product" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `/produto/${params.slug}` }],
  }),
});

function ProdutoPage() {
  const { slug } = Route.useParams();
  const consulta = useQuery({
    queryKey: ["produto-publico", slug],
    queryFn: () => getPublicProduct(slug),
  });

  if (consulta.isLoading) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-5xl px-6 pb-24 pt-36">
          <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-muted" />
        </div>
      </SiteLayout>
    );
  }

  if (consulta.error) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-3xl px-6 pb-24 pt-36">
          <StateNote text="Não conseguimos carregar esta peça agora. Tente novamente em instantes." />
        </div>
      </SiteLayout>
    );
  }

  const p = consulta.data;
  if (!p) {
    throw notFound();
  }

  const preco = formatPreco(p.price_cents);

  return (
    <SiteLayout>
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

            {p.variantes.length > 1 ? (
              <ul className="mt-6 flex flex-wrap gap-2">
                {p.variantes.map((v) => (
                  <li key={v.id} className="rounded-full border border-border px-4 py-1 text-sm text-foreground">
                    {v.label}
                  </li>
                ))}
              </ul>
            ) : null}

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

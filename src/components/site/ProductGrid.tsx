import { Link } from "@tanstack/react-router";
import { formatPreco, mediaUrl, type ProdutoVitrine } from "@/lib/storefront";

export function ProductCard({ p }: { p: ProdutoVitrine }) {
  const capa = mediaUrl(p.cover_media_id);
  const preco = formatPreco(p.price_cents);
  return (
    <Link
      to="/produto/$slug"
      params={{ slug: p.slug }}
      className="group overflow-hidden rounded-2xl border border-border bg-card focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <div className="aspect-square w-full overflow-hidden bg-muted">
        {capa ? (
          <img
            src={capa}
            alt={p.cover_alt ?? p.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Sem foto
          </div>
        )}
      </div>
      <div className="space-y-1 p-5">
        <p className="font-display text-xl text-foreground">{p.name}</p>
        {p.short_description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{p.short_description}</p>
        ) : null}
        <p className="pt-1 text-sm text-foreground">{preco ?? "Consulte sua consultora"}</p>
      </div>
    </Link>
  );
}

export function ProductGrid({ produtos }: { produtos: ProdutoVitrine[] }) {
  return (
    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {produtos.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </div>
  );
}

export function StateNote({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

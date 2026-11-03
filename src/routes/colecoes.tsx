import { createFileRoute, Link } from "@tanstack/react-router";
import { listPublicCategories } from "@/lib/storefront";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";
import { canonical, jsonLdScript, pageMeta, webPageLd } from "@/lib/seo";

const TITULO = "Coleções de semijoias em banho de ouro | LARDAN";
const DESCRICAO = "Conheça as linhas de semijoias Lardan em banho de ouro: anéis, brincos, colares e pulseiras, com acesso direto às peças publicadas.";

export const Route = createFileRoute("/colecoes")({
  component: ColecoesPage,
  loader: async () => (await listPublicCategories().catch(() => [])).filter((c) => c.produtos > 0),
  head: () => ({
    meta: [
      ...pageMeta({ title: TITULO, description: DESCRICAO, path: "/colecoes" }),
      // Nenhuma coleção publicada ainda: a página permanece no site e no menu,
      // mas não é enviada para indexação (evita soft 404).
      { name: "robots", content: "noindex, follow" },
    ],
    links: canonical("/colecoes"),
    scripts: [
      jsonLdScript(webPageLd({ path: "/colecoes", name: TITULO, description: DESCRICAO })),
    ],
  }),
});

function ColecoesPage() {
  const categorias = Route.useLoaderData();
  return (
    <SiteLayout>
      <PageHero eyebrow="Editorial" title="Coleção" />
      <PendingNote text="A primeira coleção publicada pela equipe Lardan aparecerá aqui, com curadoria editorial e produtos reais." />
      {categorias.length > 0 && (
        <section className="mx-auto max-w-5xl px-6 pb-16" aria-labelledby="linhas-titulo">
          <h2 id="linhas-titulo" className="font-display text-2xl text-foreground">Enquanto isso, conheça nossas linhas</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {categorias.map((c) => (
              <li key={c.id}>
                <Link to="/semijoias/$categoria" params={{ categoria: c.slug }} className="block h-full rounded-2xl border border-border p-5 transition hover:border-primary">
                  <span className="block text-lg font-semibold text-foreground">{c.name}</span>
                  {c.description && <span className="mt-1 block text-sm text-muted-foreground">{c.description}</span>}
                  <span className="mt-3 block text-sm font-medium text-primary">Ver {c.produtos} peça{c.produtos === 1 ? "" : "s"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SiteLayout>
  );
}

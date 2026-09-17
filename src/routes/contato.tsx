import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { ContatoForm } from "@/components/site/ContatoForm";
import { ENDERECO_LINHAS, MAPA_URL } from "@/lib/institucional";
import { ogImageMeta } from "@/lib/seo";

export const Route = createFileRoute("/contato")({
  component: ContatoPage,
  head: () => ({
    meta: [
      { title: "Contato — LARDAN" },
      { name: "description", content: "Fale com a Lardan: atendimento e contato oficial." },
      { property: "og:title", content: "Contato — LARDAN" },
      { property: "og:description", content: "Fale com a Lardan." },
      { property: "og:url", content: "/contato" },
      ...ogImageMeta(),
    ],
    links: [{ rel: "canonical", href: "/contato" }],
  }),
});

function ContatoPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Atendimento" title="Contato" />
      <ContatoForm />

      <section aria-labelledby="contato-endereco" className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
          <h2 id="contato-endereco" className="brand-eyebrow mb-4">
            Endereço
          </h2>
          <address className="text-base not-italic leading-relaxed text-muted-foreground">
            <span className="block text-foreground">Lardan</span>
            {ENDERECO_LINHAS.map((linha) => (
              <span key={linha} className="block">
                {linha}
              </span>
            ))}
          </address>
          <a
            href={MAPA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-block text-[0.6875rem] tracking-[0.22em] uppercase text-foreground/70 underline-offset-8 transition-colors hover:text-foreground hover:underline"
          >
            Ver localização
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { ContatoForm } from "@/components/site/ContatoForm";
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
    </SiteLayout>
  );
}

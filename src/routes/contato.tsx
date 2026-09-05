import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";

export const Route = createFileRoute("/contato")({
  component: ContatoPage,
  head: () => ({
    meta: [
      { title: "Contato — LARDAN" },
      { name: "description", content: "Fale com a Lardan: atendimento e contato oficial." },
      { property: "og:title", content: "Contato — LARDAN" },
      { property: "og:description", content: "Fale com a Lardan." },
      { property: "og:url", content: "/contato" },
    ],
    links: [{ rel: "canonical", href: "/contato" }],
  }),
});

function ContatoPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Atendimento" title="Contato" />
      <PendingNote text="Os canais oficiais de atendimento estão em confirmação com a marca. O formulário de contato com registro e protocolo entra em operação na próxima etapa." />
    </SiteLayout>
  );
}

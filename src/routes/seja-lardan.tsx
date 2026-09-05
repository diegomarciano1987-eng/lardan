import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero, PendingNote } from "@/components/site/PageHero";

export const Route = createFileRoute("/seja-lardan")({
  component: SejaLardanPage,
  head: () => ({
    meta: [
      { title: "Seja Lardan — candidate-se" },
      { name: "description", content: "Candidate-se para ser consultora Lardan. Proposta de parceria sem promessa de renda garantida; cada candidatura passa por análise." },
      { property: "og:title", content: "Seja Lardan — candidate-se" },
      { property: "og:description", content: "Candidate-se para ser consultora Lardan." },
      { property: "og:url", content: "/seja-lardan" },
    ],
    links: [{ rel: "canonical", href: "/seja-lardan" }],
  }),
});

function SejaLardanPage() {
  return (
    <SiteLayout>
      <PageHero eyebrow="Seja Lardan" title="Uma parceria com a marca">
        <p>
          A Lardan está estruturando sua rede de consultoras. A candidatura
          será registrada e analisada pela equipe — sem promessa de renda,
          aprovação ou retorno garantido.
        </p>
      </PageHero>
      <PendingNote text="O formulário de candidatura (com registro seguro e protocolo) entra em operação na próxima etapa, junto com a administração do site." />
    </SiteLayout>
  );
}

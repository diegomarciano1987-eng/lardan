import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PageHero } from "@/components/site/PageHero";
import { SejaLardanForm } from "@/components/site/SejaLardanForm";


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
      <div className="px-6 pb-24">
        <SejaLardanForm />
      </div>

    </SiteLayout>
  );
}

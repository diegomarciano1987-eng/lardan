import { createFileRoute } from "@tanstack/react-router";
import { SejaLardanForm } from "@/components/site/SejaLardanForm";
import wordmark from "@/assets/lardan-wordmark.png.asset.json";

/**
 * Link exclusivo de indicação: só o formulário, sem menu nem rodapé com links,
 * para a convidada não se perder no site e o vínculo com a madrinha não se perder.
 */
export const Route = createFileRoute("/indicacao/$codigo")({
  component: IndicacaoPage,
  head: () => ({
    meta: [
      { title: "Convite para ser Consultora Lardan" },
      { name: "description", content: "Você recebeu um convite para se candidatar como Consultora Lardan. Preencha sua candidatura." },
      { property: "og:title", content: "Convite para ser Consultora Lardan" },
      { property: "og:description", content: "Você recebeu um convite para se candidatar como Consultora Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function IndicacaoPage() {
  const { codigo } = Route.useParams();
  const valido = /^[a-z0-9]{4,20}$/i.test(codigo);
  return (
    <main className="min-h-screen bg-background">
      <header className="flex justify-center border-b border-border px-6 py-6">
        <img src={wordmark.url} alt="Lardan" className="h-7 w-auto" />
      </header>
      <section className="mx-auto max-w-3xl px-6 pt-12 text-center">
        <p className="brand-eyebrow mb-4">Candidatura</p>
        <h1 className="text-3xl leading-tight text-foreground md:text-5xl">Seja Consultora Lardan</h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          Conte um pouco sobre você. A candidatura recebe um protocolo e é analisada pela equipe Lardan.
          Não há promessa de aprovação, prazo ou renda.
        </p>
      </section>
      <div className="px-6 py-12">
        <SejaLardanForm indicacao={valido ? codigo.toLowerCase() : undefined} modo="indicacao" />
      </div>
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        Lardan Semijoias
      </footer>
    </main>
  );
}

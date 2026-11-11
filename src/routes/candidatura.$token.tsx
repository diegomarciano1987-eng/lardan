import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { TesteCandidatura } from "@/components/candidatura-teste/TesteCandidatura";

export const Route = createFileRoute("/candidatura/$token")({
  component: Pagina,
  head: () => ({
    meta: [
      { title: "Sua candidatura Lardan — teste de perfil" },
      { name: "description", content: "Responda as 3 partes do teste de candidatura Lardan Semijoias. Leva uns 10 minutos e fica salvo a cada tela." },
      { property: "og:title", content: "Sua candidatura Lardan" },
      { property: "og:description", content: "Teste de perfil da candidatura Lardan Semijoias: uns 10 minutos, salvo a cada tela." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

function Pagina() {
  const { token } = Route.useParams();
  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b border-border px-4 py-4 text-center">
        <span className="font-display text-2xl tracking-[0.2em] text-foreground">LARDAN</span>
      </header>
      <ClientOnly fallback={<p className="p-8 text-center text-muted-foreground">Abrindo o seu teste…</p>}>
        <TesteCandidatura token={token} />
      </ClientOnly>
    </main>
  );
}

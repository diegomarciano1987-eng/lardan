import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { DocumentosAprovada } from "@/components/captacao/DocumentosAprovada";

/** 0398 — página da candidata aprovada para enviar os 4 documentos. Link pessoal: fora da busca e sem referência. */
export const Route = createFileRoute("/documentos/$token")({
  component: Pagina,
  head: () => ({
    meta: [
      { title: "Lardan — seus documentos" },
      { name: "description", content: "Envie as fotos dos documentos para seguir com a sua maleta Lardan." },
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
      <ClientOnly fallback={<p className="p-8 text-center text-muted-foreground">Abrindo…</p>}>
        <DocumentosAprovada token={token} />
      </ClientOnly>
    </main>
  );
}

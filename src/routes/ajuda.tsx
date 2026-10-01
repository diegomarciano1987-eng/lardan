import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { CentralAjuda } from "@/components/ajuda/Ajuda";

export const Route = createFileRoute("/ajuda")({
  head: () => ({
    meta: [
      { title: "Central de Ajuda — Lardan" },
      { name: "description", content: "Como aceitar o convite, entrar e recuperar o acesso ao sistema Lardan." },
      { property: "og:title", content: "Central de Ajuda — Lardan" },
      { property: "og:description", content: "Como aceitar o convite, entrar e recuperar o acesso ao sistema Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AjudaPublica,
});

function AjudaPublica() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <Link to="/equipe" className="inline-flex min-h-12 items-center gap-2 text-base underline">
        <ArrowLeft className="size-5" aria-hidden /> Voltar para o acesso
      </Link>
      <h1 className="mt-4 font-display text-3xl">Central de Ajuda</h1>
      <p className="mt-2 mb-6 text-base text-muted-foreground">Dúvidas sobre convite, entrada e senha. Depois de entrar, toque em “Ajuda” para ver todos os assuntos.</p>
      <CentralAjuda />
    </main>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { CUIDADOS, GARANTIA_ANOS } from "@/lib/consultora-regras";

export const Route = createFileRoute("/cuidados")({
  component: Cuidados,
  head: () => ({ meta: [
    { title: "Cuidados com suas semijoias — LARDAN" },
    { name: "description", content: "Manual de uso e cuidados das semijoias LARDAN. Garantia de dois anos seguindo o manual." },
    { property: "og:title", content: "Manual de cuidados — LARDAN" },
    { property: "og:description", content: "Como usar, limpar e guardar suas semijoias LARDAN." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});
function Cuidados() {
  return <main className="mx-auto max-w-3xl px-6 py-12">
    <Link to="/" className="text-lg font-semibold underline underline-offset-4">LARDAN</Link>
    <h1 className="mt-8 font-display text-4xl">Cuidados com suas semijoias</h1>
    <p className="mt-4 flex items-center gap-3 text-lg"><ShieldCheck className="size-6 shrink-0" />Garantia de {GARANTIA_ANOS} anos, seguindo este manual de uso.</p>
    <ol className="mt-10 divide-y divide-border">{CUIDADOS.map((c, i) => <li key={c.titulo} className="py-6"><h2 className="text-xl font-semibold">{i + 1}. {c.titulo}</h2><p className="mt-3 text-lg leading-relaxed">{c.texto}</p></li>)}</ol>
  </main>;
}
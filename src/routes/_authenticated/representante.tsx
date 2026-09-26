import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { fetchMyRoles } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";

export const Route = createFileRoute("/_authenticated/representante")({
  head: () => ({
    meta: [
      { title: "Área do representante — LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AreaRepresentante,
});

function AreaRepresentante() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  if (isLoading) return null;
  if (!portaLiberada("representante", roles ?? [])) return <AcessoNaoLiberado />;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <img src={wordmarkAsset.url} alt="Lardan" className="mb-10 w-48" width={650} height={210} />
      <p className="brand-eyebrow mb-3">Representante</p>
      <h1 className="font-display text-3xl text-foreground">Área em preparação</h1>
      <p className="mt-4 max-w-md text-sm text-muted-foreground">
        Sua área de representante está sendo construída. Você será avisado quando estiver disponível.
      </p>
      <Link to="/" className="mt-8 text-xs tracking-[0.18em] uppercase text-muted-foreground underline">
        Voltar ao site
      </Link>
    </main>
  );
}

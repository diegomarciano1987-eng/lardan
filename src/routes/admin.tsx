import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
  head: () => ({
    meta: [
      { title: "Administração — LARDAN" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AdminPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md text-center">
        <p className="brand-eyebrow mb-4">Área restrita</p>
        <h1 className="text-3xl text-foreground">Administração Lardan</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Esta área exigirá autenticação com autorização por perfil. O painel
          entra em operação na próxima etapa da implantação, com conteúdo,
          produtos, leads e configurações reais — sem dados de demonstração.
        </p>
        <Link
          to="/acesso"
          className="mt-8 inline-flex items-center rounded-full bg-primary px-7 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground"
        >
          Ir para o acesso
        </Link>
      </div>
    </div>
  );
}

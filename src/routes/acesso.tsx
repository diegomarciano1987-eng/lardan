import { createFileRoute } from "@tanstack/react-router";
import { SiteLayout } from "@/components/site/SiteLayout";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";

export const Route = createFileRoute("/acesso")({
  component: AcessoPage,
  head: () => ({
    meta: [
      { title: "Acessar Lardan" },
      { name: "description", content: "Acesso à área administrativa Lardan." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function AcessoPage() {
  return (
    <SiteLayout>
      <section className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6">
        <img
          src={wordmarkAsset.url}
          alt="Lardan"
          className="mb-10 w-56"
          width={650}
          height={210}
        />
        <h1 className="sr-only">Acessar Lardan</h1>
        <form
          className="w-full space-y-4"
          onSubmit={(e) => e.preventDefault()}
          aria-describedby="aviso-acesso"
        >
          <div>
            <label htmlFor="email" className="brand-eyebrow mb-2 block">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              disabled
              className="w-full rounded-md border border-input bg-card px-4 py-3 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label htmlFor="senha" className="brand-eyebrow mb-2 block">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              disabled
              className="w-full rounded-md border border-input bg-card px-4 py-3 text-sm disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled
            className="w-full rounded-full bg-primary px-6 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground disabled:opacity-60"
          >
            Entrar
          </button>
        </form>
        <p id="aviso-acesso" className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          A autenticação será ativada na próxima etapa da implantação, junto
          com a administração do site. Não existe conta de acesso nesta fase.
        </p>
      </section>
    </SiteLayout>
  );
}

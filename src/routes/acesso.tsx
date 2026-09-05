import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/acesso")({
  component: AcessoPage,
  head: () => ({
    meta: [
      { title: "Acessar Lardan" },
      { name: "description", content: "Acesso à área administrativa Lardan." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function AcessoPage() {
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: "/admin", replace: true });
    }
  }, [loading, session, navigate]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setBusy(false);
    if (error) {
      setErro("Não foi possível entrar. Confira o e-mail e a senha.");
      return;
    }
    void navigate({ to: "/admin", replace: true });
  }

  async function entrarComGoogle() {
    setErro(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/acesso",
    });
    if (result.error) {
      setBusy(false);
      setErro("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/admin", replace: true });
  }

  return (
    <SiteLayout>
      <section className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 py-32">
        <img
          src={wordmarkAsset.url}
          alt="Lardan"
          className="mb-10 w-56"
          width={650}
          height={210}
        />
        <h1 className="sr-only">Acessar Lardan</h1>

        <form className="w-full space-y-4" onSubmit={entrar} aria-describedby="aviso-acesso">
          <div>
            <label htmlFor="email" className="brand-eyebrow mb-2 block">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
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
              required
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={inputClass}
            />
          </div>

          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <div className="my-6 flex w-full items-center gap-4">
          <span className="rose-rule flex-1" />
          <span className="brand-eyebrow">ou</span>
          <span className="rose-rule flex-1" />
        </div>

        <button
          type="button"
          onClick={entrarComGoogle}
          disabled={busy}
          className="w-full rounded-full border border-primary/40 px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Entrar com Google
        </button>

        <p id="aviso-acesso" className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Área restrita à equipe Lardan. Os acessos são registrados em auditoria.
        </p>
      </section>
    </SiteLayout>
  );
}

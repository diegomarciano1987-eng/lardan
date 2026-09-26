import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/minha-conta")({
  head: () => ({
    meta: [
      { title: "Minha conta — Lardan" },
      { name: "description", content: "Entre ou crie sua conta de cliente na loja Lardan." },
      { property: "og:title", content: "Minha conta — Lardan" },
      { property: "og:description", content: "Entre ou crie sua conta de cliente na loja Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MinhaConta,
});

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const botao =
  "w-full rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";

function MinhaConta() {
  const { session, loading } = useSession();
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setBusy(true);
    if (modo === "entrar") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
      if (error) setErro("Não foi possível entrar. Confira o e-mail e a senha.");
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password: senha,
        options: { emailRedirectTo: window.location.origin + "/minha-conta", data: { full_name: nome } },
      });
      if (error) setErro("Não foi possível criar a conta. Confira os dados e tente novamente.");
      else setAviso("Enviamos um e-mail de confirmação. Abra o link para ativar sua conta.");
    }
    setBusy(false);
  }

  async function google() {
    setErro(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/minha-conta",
    });
    if (result.error) {
      setBusy(false);
      setErro("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    setBusy(false);
  }

  const usuario = session?.user;
  const nomeExibido = (usuario?.user_metadata?.full_name as string | undefined) ?? usuario?.email;

  return (
    <SiteLayout>
      <section className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 py-32">
        <img src={wordmarkAsset.url} alt="Lardan" className="mb-10 w-52" width={650} height={210} />
        {loading ? null : usuario ? (
          <div className="w-full text-center">
            <p className="brand-eyebrow mb-3">Minha conta</p>
            <h1 className="font-display text-3xl text-foreground">Olá, {nomeExibido}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{usuario.email}</p>
            <div className="mt-10 rounded-2xl border border-border bg-card px-6 py-8">
              <p className="brand-eyebrow mb-2">Meus pedidos</p>
              <p className="text-sm text-muted-foreground">Você ainda não tem pedidos.</p>
            </div>
            <button type="button" onClick={() => void supabase.auth.signOut()} className={`${botao} mt-8`}>
              Sair
            </button>
          </div>
        ) : (
          <>
            <h1 className="mb-8 font-display text-3xl text-foreground">
              {modo === "entrar" ? "Entrar na minha conta" : "Criar minha conta"}
            </h1>
            <button
              type="button"
              onClick={google}
              disabled={busy}
              className="w-full rounded-full border border-primary/40 px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-60"
            >
              Continuar com Google
            </button>
            <div className="my-6 flex w-full items-center gap-4">
              <span className="rose-rule flex-1" />
              <span className="brand-eyebrow">ou</span>
              <span className="rose-rule flex-1" />
            </div>
            <form className="w-full space-y-4" onSubmit={enviar}>
              {modo === "criar" && (
                <div>
                  <label htmlFor="nome" className="brand-eyebrow mb-2 block">Nome</label>
                  <input id="nome" required autoComplete="name" value={nome}
                    onChange={(e) => setNome(e.target.value)} className={inputClass} />
                </div>
              )}
              <div>
                <label htmlFor="email" className="brand-eyebrow mb-2 block">E-mail</label>
                <input id="email" type="email" required autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="senha" className="brand-eyebrow mb-2 block">Senha</label>
                <input id="senha" type="password" required minLength={8}
                  autoComplete={modo === "entrar" ? "current-password" : "new-password"} value={senha}
                  onChange={(e) => setSenha(e.target.value)} className={inputClass} />
              </div>
              {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
              {aviso && <p className="text-sm text-foreground">{aviso}</p>}
              <button type="submit" disabled={busy} className={botao}>
                {busy ? "Aguarde…" : modo === "entrar" ? "Entrar" : "Criar conta"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => { setModo(modo === "entrar" ? "criar" : "entrar"); setErro(null); setAviso(null); }}
              className="mt-6 text-xs text-muted-foreground underline"
            >
              {modo === "entrar" ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}
            </button>
          </>
        )}
      </section>
    </SiteLayout>
  );
}

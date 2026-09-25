import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/redefinir-senha")({
  component: RedefinirSenha,
  head: () => ({
    meta: [
      { title: "Redefinir senha — LARDAN" },
      { name: "description", content: "Recupere o acesso à sua conta da Lardan." },
      { property: "og:title", content: "Redefinir senha — LARDAN" },
      { property: "og:description", content: "Recupere o acesso à sua conta da Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function RedefinirSenha() {
  const navigate = useNavigate();
  const [recuperacao, setRecuperacao] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [erro, setErro] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);

  React.useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setRecuperacao(true);
    const { data } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === "PASSWORD_RECOVERY") setRecuperacao(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setOcupado(false);
    if (error) setErro("Não foi possível enviar agora. Tente de novo em alguns minutos.");
    else setMsg("Se este e-mail tiver conta, você vai receber um link para criar uma nova senha.");
  }

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.");
    setOcupado(true);
    setErro("");
    const { error } = await supabase.auth.updateUser({ password: senha });
    setOcupado(false);
    if (error) return setErro(error.message);
    void navigate({ to: "/admin", replace: true });
  }

  const campo = "mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base";
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Lardan</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">{recuperacao ? "Crie uma nova senha" : "Esqueci minha senha"}</h1>
        {recuperacao ? (
          <form onSubmit={trocar} className="mt-6 space-y-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Nova senha (mín. 8)</span>
              <input type="password" required autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} className={campo} />
            </label>
            <button disabled={ocupado} className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Salvar nova senha
            </button>
          </form>
        ) : (
          <form onSubmit={pedir} className="mt-6 space-y-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Seu e-mail</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} />
            </label>
            <button disabled={ocupado} className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Enviar link
            </button>
          </form>
        )}
        {msg && <p className="mt-4 rounded-xl bg-muted p-4 text-sm text-foreground">{msg}</p>}
        {erro && <p className="mt-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{erro}</p>}
      </div>
    </main>
  );
}

import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { aceitarConvite, consultarConvite } from "@/lib/acessos.functions";

export const Route = createFileRoute("/convite/$token")({
  component: ConvitePage,
  head: () => ({
    meta: [
      { title: "Convite de acesso — LARDAN" },
      { name: "description", content: "Aceite seu convite de acesso ao sistema da Lardan." },
      { property: "og:title", content: "Convite de acesso — LARDAN" },
      { property: "og:description", content: "Aceite seu convite de acesso ao sistema da Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const MSG: Record<string, string> = {
  invalido: "Este link de convite não é válido. Confira se copiou o endereço inteiro.",
  utilizado: "Este convite já foi utilizado. Se foi você, é só entrar com seu e-mail e senha.",
  revogado: "Este convite foi cancelado pela Lardan. Peça um novo a quem convidou você.",
  expirado: "Este convite venceu (vale 48 horas). Peça um novo a quem convidou você.",
  bloqueado: "Este convite foi bloqueado por excesso de tentativas. Peça um novo.",
};

function ConvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const consultar = useServerFn(consultarConvite);
  const aceitar = useServerFn(aceitarConvite);
  const [info, setInfo] = React.useState<Awaited<ReturnType<typeof consultarConvite>> | null>(null);
  const [erro, setErro] = React.useState("");
  const [aviso, setAviso] = React.useState("");
  const [modo, setModo] = React.useState<"criar" | "entrar">("criar");
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);

  React.useEffect(() => {
    consultar({ data: { token } }).then(setInfo).catch(() => setInfo({ situacao: "invalido" }));
  }, [token, consultar]);

  async function concluir() {
    setOcupado(true);
    setErro("");
    try {
      const r = await aceitar({ data: { token } });
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível aceitar.");
        return;
      }
      const destino = "/admin";
      void navigate({ to: destino, replace: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aceitar.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    setOcupado(true);
    try {
      if (modo === "criar") {
        if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password: senha,
          options: { emailRedirectTo: `${window.location.origin}/convite/${token}` },
        });
        if (error) throw error;
        if (!data.session) {
          setAviso("Enviamos um e-mail de confirmação. Abra-o neste aparelho e toque no link para concluir o aceite.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
        if (error) throw new Error("E-mail ou senha incorretos.");
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "Falha.";
      setErro(/already registered|already exists/i.test(m) ? "Já existe conta com este e-mail. Use “Já tenho conta”." : m);
    } finally {
      setOcupado(false);
    }
  }

  const valido = info?.situacao === "valido";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Lardan</p>
        <h1 className="mt-2 font-serif text-2xl text-foreground">Convite de acesso</h1>

        {!info || loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Conferindo o convite…</p>
        ) : !valido ? (
          <p className="mt-6 rounded-xl bg-muted p-4 text-sm text-foreground">{MSG[info.situacao] ?? MSG.invalido}</p>
        ) : (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              {info.nome ? `${info.nome}, você` : "Você"} foi convidada para acessar o sistema com o e-mail{" "}
              <strong className="text-foreground">{info.email_mascarado}</strong>.
            </p>
            {session ? (
              <div className="mt-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Conectada como <strong className="text-foreground">{session.user.email}</strong>.
                </p>
                <button type="button" disabled={ocupado} onClick={() => void concluir()}
                  className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {ocupado ? "Aceitando…" : "Aceitar convite"}
                </button>
                <button type="button" onClick={() => void supabase.auth.signOut()}
                  className="w-full text-sm text-muted-foreground underline">
                  Não sou eu — sair
                </button>
              </div>
            ) : (
              <form onSubmit={enviar} className="mt-6 space-y-3">
                <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-sm">
                  {(["criar", "entrar"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setModo(m)}
                      className={`rounded-full py-2 ${modo === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                      {m === "criar" ? "Criar minha senha" : "Já tenho conta"}
                    </button>
                  ))}
                </div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">E-mail do convite</span>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                    className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base" />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">{modo === "criar" ? "Crie uma senha (mín. 8)" : "Senha"}</span>
                  <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
                    autoComplete={modo === "criar" ? "new-password" : "current-password"}
                    className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-base" />
                </label>
                <button type="submit" disabled={ocupado}
                  className="w-full rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                  {ocupado ? "Aguarde…" : modo === "criar" ? "Criar senha e confirmar e-mail" : "Entrar"}
                </button>
                {modo === "entrar" && (
                  <a href="/redefinir-senha" className="block text-center text-sm text-muted-foreground underline">Esqueci minha senha</a>
                )}
              </form>
            )}
          </>
        )}
        {aviso && <p className="mt-4 rounded-xl bg-muted p-4 text-sm text-foreground">{aviso}</p>}
        {erro && <p className="mt-4 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{erro}</p>}
      </div>
    </main>
  );
}

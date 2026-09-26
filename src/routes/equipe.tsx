import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BriefcaseBusiness, Gem, Map } from "lucide-react";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyRoles } from "@/lib/session";
import { DESTINO, PORTAS, portaLiberada, type Porta } from "@/lib/portas";

type Busca = { area?: Porta | undefined };

export const Route = createFileRoute("/equipe")({
  validateSearch: (s: Record<string, unknown>): Busca => ({
    area: PORTAS.includes(s["area"] as Porta) ? (s["area"] as Porta) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sistema Lardan — Acesso da equipe" },
      { name: "description", content: "Acesso restrito à operação, consultoras e representantes Lardan." },
      { property: "og:title", content: "Sistema Lardan — Acesso da equipe" },
      { property: "og:description", content: "Acesso restrito à operação, consultoras e representantes Lardan." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: EquipePage,
});

const CARTOES: { id: Porta; titulo: string; texto: string; icone: typeof Gem }[] = [
  { id: "operacao", titulo: "Operação", texto: "Colaboradores da Lardan", icone: BriefcaseBusiness },
  { id: "consultora", titulo: "Consultora", texto: "Maleta, vitrine e pedidos", icone: Gem },
  { id: "representante", titulo: "Representante", texto: "Sua carteira e região", icone: Map },
];

const inputClass =
  "w-full rounded-md border border-input bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function EquipePage() {
  const { area } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function seguir(porta: Porta) {
    const roles = await fetchMyRoles().catch(() => []);
    if (!portaLiberada(porta, roles)) {
      await supabase.auth.signOut();
      setErro("Seu acesso não está liberado para esta área.");
      return;
    }
    void navigate({ to: DESTINO[porta], replace: true });
  }

  // Já conectado: confere a porta escolhida.
  useEffect(() => {
    if (!area) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void seguir(area);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!area) return;
    setErro(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      setBusy(false);
      setErro("Não foi possível entrar. Confira o e-mail e a senha.");
      return;
    }
    await seguir(area);
    setBusy(false);
  }

  const escolhido = CARTOES.find((c) => c.id === area);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-gradient-to-b from-primary/10 to-transparent"
      />
      <Link to="/" className="relative mb-12">
        <img src={wordmarkAsset.url} alt="Lardan" className="w-48 md:w-56" width={650} height={210} />
      </Link>

      {!escolhido ? (
        <div className="relative w-full max-w-4xl text-center">
          <p className="brand-eyebrow mb-3">Sistema Lardan</p>
          <h1 className="font-display text-3xl text-foreground md:text-4xl">Por qual porta você entra?</h1>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {CARTOES.map(({ id, titulo, texto, icone: Icone }) => (
              <Link
                key={id}
                to="/equipe"
                search={{ area: id }}
                className="group flex flex-col items-center rounded-2xl border border-primary/25 bg-card px-8 py-12 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                <span className="grid h-16 w-16 place-items-center rounded-full border border-primary/30 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icone className="h-7 w-7" strokeWidth={1.3} />
                </span>
                <span className="mt-6 font-display text-2xl text-foreground">{titulo}</span>
                <span className="mt-2 text-sm text-muted-foreground">{texto}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative w-full max-w-sm">
          <Link
            to="/equipe"
            className="mb-8 inline-flex items-center gap-2 text-xs tracking-[0.18em] uppercase text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Trocar porta
          </Link>
          <p className="brand-eyebrow mb-2">Acesso</p>
          <h1 className="mb-8 font-display text-3xl text-foreground">{escolhido.titulo}</h1>
          <form className="space-y-4" onSubmit={entrar}>
            <div>
              <label htmlFor="email" className="brand-eyebrow mb-2 block">E-mail</label>
              <input id="email" type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="senha" className="brand-eyebrow mb-2 block">Senha</label>
              <input id="senha" type="password" required autoComplete="current-password" value={senha}
                onChange={(e) => setSenha(e.target.value)} className={inputClass} />
            </div>
            <Link to="/redefinir-senha" className="-mt-2 block text-right text-xs text-muted-foreground underline">
              Esqueci minha senha
            </Link>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-primary px-8 py-3 text-[0.75rem] tracking-[0.22em] uppercase text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      )}

      <p className="relative mt-14 max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
        Área restrita à equipe Lardan, com acesso somente por convite.
      </p>
    </main>
  );
}

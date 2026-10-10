import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, HandCoins, LogOut, Sparkles, Users } from "lucide-react";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { fetchMyRoles } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";
import { supabase } from "@/integrations/supabase/client";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { AberturaApp, InstalarApp } from "@/components/consultora/InstalarApp";

type Aba = "cobranca" | "consultoras" | "captacao" | "painel";
const ABAS: { id: Aba; rotulo: string; icone: typeof Users; descricao: string }[] = [
  { id: "cobranca", rotulo: "Acerto e cobrança", icone: HandCoins, descricao: "Fechamento de maleta, cheque, Pix, boleto e link de cartão em até 3x." },
  { id: "consultoras", rotulo: "Consultoras", icone: Users, descricao: "Sua carteira de consultoras ativas e as inativas da sua região." },
  { id: "captacao", rotulo: "Captação", icone: Sparkles, descricao: "Candidaturas encaminhadas pelo Daniel e seu link Seja Lardan." },
  { id: "painel", rotulo: "Painel", icone: BarChart3, descricao: "Rankings por valor e peças, período e mapa da carteira." },
];
const ETAPA: Record<Aba, number> = { cobranca: 2, consultoras: 2, captacao: 3, painel: 4 };

export const Route = createFileRoute("/_authenticated/representante")({
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } => {
    const a = s["aba"] as Aba;
    return ABAS.some((x) => x.id === a) ? { aba: a } : {};
  },
  head: () => ({
    meta: [
      { title: "Área do representante — LARDAN" },
      { name: "description", content: "Área do representante LARDAN." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#1c1614" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "LARDAN Rep" },
    ],
    links: [
      { rel: "manifest", href: "/representante.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/consultora-apple-180.png" },
    ],
  }),
  component: AreaRepresentante,
});

async function meuCadastro() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data: p } = await supabase.from("profiles").select("party_id").eq("id", u.user.id).maybeSingle();
  const partyId = (p as { party_id?: string | null } | null)?.party_id ?? null;
  let nome: string | null = null;
  if (partyId) {
    const { data: party } = await supabase.from("parties").select("*").eq("id", partyId).maybeSingle();
    const r = party as Record<string, unknown> | null;
    nome = (r?.["display_name"] ?? r?.["full_name"] ?? r?.["name"] ?? null) as string | null;
  }
  return { email: u.user.email ?? "", partyId, nome };
}

function AreaRepresentante() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  const eu = useQuery({ queryKey: ["representante", "eu"], queryFn: meuCadastro });
  const { aba = "cobranca" } = Route.useSearch();
  const navigate = useNavigate({ from: "/representante" });
  const atual = ABAS.find((a) => a.id === aba)!;
  const ir = (id: Aba) => void navigate({ search: { aba: id }, replace: true });
  const sair = async () => { await supabase.auth.signOut(); window.location.href = "/acesso"; };

  if (isLoading) return null;
  if (!portaLiberada("representante", roles ?? [])) return <AcessoNaoLiberado />;

  const primeiroNome = (eu.data?.nome ?? "").split(" ")[0];

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <AberturaApp />
      {/* Desktop: barra lateral */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card p-6 md:flex">
        <img src={wordmarkAsset.url} alt="Lardan" className="mb-2 w-32" width={650} height={210} />
        <p className="brand-eyebrow mb-8">Representante</p>
        <nav className="flex flex-col gap-1">
          {ABAS.map((a) => (
            <button key={a.id} type="button" onClick={() => ir(a.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${aba === a.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}>
              <a.icone className="size-4" aria-hidden /> {a.rotulo}
            </button>
          ))}
        </nav>
        <button type="button" onClick={() => void sair()} className="mt-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <LogOut className="size-4" /> Sair
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="flex items-center justify-between border-b border-border px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] md:px-10 md:py-6">
          <div>
            <p className="brand-eyebrow md:hidden">LARDAN · Representante</p>
            <h1 className="font-display text-2xl md:text-3xl">{primeiroNome ? `Olá, ${primeiroNome}` : "Sua área"}</h1>
            {eu.data && !eu.data.partyId && (
              <p className="mt-1 text-sm text-warning">Seu login ainda não está ligado à sua ficha. Peça ao Daniel para vincular.</p>
            )}
          </div>
          <button type="button" onClick={() => void sair()} className="grid size-11 place-items-center rounded-full active:bg-muted md:hidden" aria-label="Sair">
            <LogOut className="size-5" />
          </button>
        </header>

        <main className="flex-1 space-y-6 px-5 py-6 md:px-10">
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><atual.icone className="size-5" /></span>
              <div>
                <h2 className="text-lg font-semibold">{atual.rotulo}</h2>
                <p className="text-sm text-muted-foreground">{atual.descricao}</p>
              </div>
            </div>
            <p className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              Sem dados por enquanto. Esta parte chega na etapa {ETAPA[aba]} da construção.
            </p>
          </section>
          <div className="md:hidden"><InstalarApp /></div>
          <Link to="/" className="block text-center text-xs uppercase tracking-[0.18em] text-muted-foreground underline md:text-left">Voltar ao site</Link>
        </main>
      </div>

      {/* Celular: abas inferiores */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {ABAS.map((a) => (
          <button key={a.id} type="button" onClick={() => ir(a.id)}
            className={`flex flex-col items-center gap-1 py-3 text-[0.7rem] ${aba === a.id ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            <a.icone className="size-5" aria-hidden /> {a.rotulo.split(" ")[0]}
          </button>
        ))}
      </nav>
    </div>
  );
}

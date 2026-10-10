import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Eye, HandCoins, LogOut, MessageCircle, Search, Sparkles, Users } from "lucide-react";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { fetchMyRoles, type AppRole } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";
import { supabase } from "@/integrations/supabase/client";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { AberturaApp, InstalarApp } from "@/components/consultora/InstalarApp";
import { brl, dataBR, repCobrancas, repConsultoras, repResumo } from "@/lib/representante";

type Aba = "cobranca" | "consultoras" | "captacao" | "painel";
const ABAS: { id: Aba; rotulo: string; curto: string; icone: typeof Users }[] = [
  { id: "cobranca", rotulo: "Acerto e cobrança", curto: "Cobrança", icone: HandCoins },
  { id: "consultoras", rotulo: "Consultoras", curto: "Consultoras", icone: Users },
  { id: "captacao", rotulo: "Captação", curto: "Captação", icone: Sparkles },
  { id: "painel", rotulo: "Painel", curto: "Painel", icone: BarChart3 },
];
const ESPELHO: AppRole[] = ["master", "diretoria", "financeiro", "cobranca"] as AppRole[];
const UUID = /^[0-9a-f-]{36}$/i;

export const Route = createFileRoute("/_authenticated/representante")({
  validateSearch: (s: Record<string, unknown>): { aba?: Aba; rep?: string } => {
    const a = s["aba"] as Aba;
    const r = typeof s["rep"] === "string" && UUID.test(s["rep"]) ? s["rep"] : undefined;
    return { ...(ABAS.some((x) => x.id === a) ? { aba: a } : {}), ...(r ? { rep: r } : {}) };
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

async function minhaFicha(): Promise<string | null> {
  const { data } = await supabase.rpc("my_party_id" as never);
  return (data as string | null) ?? null;
}

function AreaRepresentante() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  const minha = useQuery({ queryKey: ["representante", "minha-ficha"], queryFn: minhaFicha });
  const { aba = "cobranca", rep: repEspelho } = Route.useSearch();
  const navigate = useNavigate({ from: "/representante" });
  const sair = async () => { await supabase.auth.signOut(); window.location.href = "/acesso"; };

  if (isLoading || minha.isLoading) return null;
  const r = roles ?? [];
  const espelho = !!repEspelho;
  if (espelho ? !r.some((x) => ESPELHO.includes(x)) : !portaLiberada("representante", r)) return <AcessoNaoLiberado />;
  const rep = repEspelho ?? minha.data ?? null;
  const ir = (id: Aba) => void navigate({ search: (s) => ({ ...s, aba: id }), replace: true });

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      {!espelho && <AberturaApp />}
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
        {!espelho && (
          <button type="button" onClick={() => void sair()} className="mt-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
            <LogOut className="size-4" /> Sair
          </button>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
        {espelho && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-primary px-5 py-2 text-sm text-primary-foreground md:px-10">
            <span className="flex items-center gap-2"><Eye className="size-4" /> Você está vendo exatamente o sistema deste representante (somente leitura).</span>
            <Link to="/admin/cadastros/pessoas/$id" params={{ id: repEspelho! }} className="flex items-center gap-1 underline">
              <ArrowLeft className="size-4" /> Voltar à ficha
            </Link>
          </div>
        )}
        {!rep ? (
          <main className="px-5 py-10 md:px-10">
            <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Seu login ainda não está ligado à sua ficha de representante. Peça ao Daniel para vincular.</p>
          </main>
        ) : (
          <Painel rep={rep} aba={aba} espelho={espelho} onSair={sair} />
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {ABAS.map((a) => (
          <button key={a.id} type="button" onClick={() => ir(a.id)}
            className={`flex flex-col items-center gap-1 py-3 text-[0.7rem] ${aba === a.id ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            <a.icone className="size-5" aria-hidden /> {a.curto}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Painel({ rep, aba, espelho, onSair }: { rep: string; aba: Aba; espelho: boolean; onSair: () => Promise<void> }) {
  const resumo = useQuery({ queryKey: ["rep", rep, "resumo"], queryFn: () => repResumo(rep) });
  const nome = resumo.data?.nome ?? "";
  const primeiro = nome.split(" ")[0] ?? "";
  const s = resumo.data;
  return (
    <>
      <header className="flex items-center justify-between border-b border-border px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] md:px-10 md:py-6">
        <div>
          <p className="brand-eyebrow md:hidden">LARDAN · Representante</p>
          <h1 className="font-display text-2xl md:text-3xl">{primeiro ? `Olá, ${primeiro.charAt(0)}${primeiro.slice(1).toLowerCase()}` : "Sua área"}</h1>
          {nome && <p className="text-sm text-muted-foreground">{nome}</p>}
        </div>
        {!espelho && (
          <button type="button" onClick={() => void onSair()} className="grid size-11 place-items-center rounded-full active:bg-muted md:hidden" aria-label="Sair">
            <LogOut className="size-5" />
          </button>
        )}
      </header>
      <main className="flex-1 space-y-6 px-5 py-6 md:px-10">
        {resumo.error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{(resumo.error as Error).message}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi rotulo="Vencido" valor={s ? brl(s.vencido_cents) : "—"} destaque />
          <Kpi rotulo="Vence hoje" valor={s ? brl(s.hoje_cents) : "—"} />
          <Kpi rotulo="Em aberto" valor={s ? brl(s.aberto_cents) : "—"} sub={s ? `${s.parcelas} parcelas · ${s.devedoras} devedoras` : ""} />
          <Kpi rotulo="Consultoras" valor={s ? String(s.consultoras) : "—"} sub={s ? `${s.ativas} ativas · ${s.maletas_campo} maletas em campo` : ""} />
        </div>
        {aba === "cobranca" && <Cobrancas rep={rep} />}
        {aba === "consultoras" && <Consultoras rep={rep} />}
        {(aba === "captacao" || aba === "painel") && (
          <section className="rounded-2xl border border-border bg-card p-6">
            <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Sem dados por enquanto. Esta parte chega na etapa {aba === "captacao" ? 3 : 4}.</p>
          </section>
        )}
        {!espelho && <div className="md:hidden"><InstalarApp /></div>}
      </main>
    </>
  );
}

function Kpi({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums md:text-2xl ${destaque ? "text-destructive" : ""}`}>{valor}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Chips({ op, valor, set }: { op: [string, string][]; valor: string; set: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {op.map(([v, l]) => (
        <button key={v} type="button" onClick={() => set(v)}
          className={`rounded-full border px-3 py-1.5 text-sm ${valor === v ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"}`}>{l}</button>
      ))}
    </div>
  );
}

function Paginas({ pagina, total, set }: { pagina: number; total: number; set: (n: number) => void }) {
  const ult = Math.max(1, Math.ceil(total / 50));
  return (
    <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
      <span>{total} no total · página {pagina} de {ult}</span>
      <div className="flex gap-2">
        <button type="button" disabled={pagina <= 1} onClick={() => set(pagina - 1)} className="grid size-10 place-items-center rounded-full border border-border disabled:opacity-40" aria-label="Anterior"><ChevronLeft className="size-4" /></button>
        <button type="button" disabled={pagina >= ult} onClick={() => set(pagina + 1)} className="grid size-10 place-items-center rounded-full border border-border disabled:opacity-40" aria-label="Próxima"><ChevronRight className="size-4" /></button>
      </div>
    </div>
  );
}

function Cobrancas({ rep }: { rep: string }) {
  const [filtro, setFiltro] = React.useState("vencidas");
  const [pagina, setPagina] = React.useState(1);
  const q = useQuery({ queryKey: ["rep", rep, "cob", filtro, pagina], queryFn: () => repCobrancas(rep, filtro, pagina), placeholderData: keepPreviousData });
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold">Cobranças da carteira</h2>
      <Chips op={[["vencidas", "Vencidas"], ["hoje", "Hoje"], ["a_vencer", "A vencer"], ["todas", "Todas"]]} valor={filtro} set={(v) => { setFiltro(v); setPagina(1); }} />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && q.data.itens.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma parcela neste filtro.</p>}
      <ul className="divide-y divide-border">
        {q.data?.itens.map((c) => (
          <li key={c.installment_id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{c.display_name}</p>
              <p className="text-xs text-muted-foreground">{c.code} · título {c.numero ?? "—"} · vence {dataBR(c.vencimento)}</p>
            </div>
            <span className="shrink-0 font-semibold tabular-nums">{brl(c.saldo_cents)}</span>
          </li>
        ))}
      </ul>
      {q.data && <Paginas pagina={pagina} total={q.data.total} set={setPagina} />}
    </section>
  );
}

function Consultoras({ rep }: { rep: string }) {
  const [texto, setTexto] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState("todas");
  const [pagina, setPagina] = React.useState(1);
  React.useEffect(() => { const t = setTimeout(() => { setBusca(texto); setPagina(1); }, 300); return () => clearTimeout(t); }, [texto]);
  const q = useQuery({ queryKey: ["rep", rep, "cons", busca, filtro, pagina], queryFn: () => repConsultoras(rep, busca, filtro, pagina), placeholderData: keepPreviousData });
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold">Minhas consultoras</h2>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3">
        <Search className="size-4 text-muted-foreground" />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nome ou código" className="h-11 w-full bg-transparent outline-none" />
      </label>
      <Chips op={[["todas", "Todas"], ["ativas", "Ativas"], ["inativas", "Inativas"], ["devedoras", "Com débito"]]} valor={filtro} set={(v) => { setFiltro(v); setPagina(1); }} />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && q.data.itens.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma consultora encontrada.</p>}
      <ul className="divide-y divide-border">
        {q.data?.itens.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{c.display_name}</p>
              <p className="text-xs text-muted-foreground">{c.code} · {c.cidade ?? "sem cidade"} · {c.status === "ativo" ? "ativa" : "inativa"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {c.aberto_cents > 0 && (
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{brl(c.aberto_cents)}</p>
                  {c.vencido_cents > 0 && <p className="text-xs text-destructive tabular-nums">{brl(c.vencido_cents)} vencido</p>}
                </div>
              )}
              {c.whatsapp && (
                <a href={`https://wa.me/55${c.whatsapp.replace(/\D/g, "").replace(/^55/, "")}`} target="_blank" rel="noreferrer" className="grid size-10 place-items-center rounded-full border border-border" aria-label="WhatsApp">
                  <MessageCircle className="size-4" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Paginas pagina={pagina} total={q.data.total} set={setPagina} />}
    </section>
  );
}

import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Briefcase, CalendarDays, ChevronLeft, ChevronRight, Eye, HandCoins, LogOut, Search, Sparkles, Users } from "lucide-react";
import wordmarkAsset from "@/assets/lardan-wordmark.png.asset.json";
import { fetchMyRoles, type AppRole } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";
import { supabase } from "@/integrations/supabase/client";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { AberturaApp, InstalarApp } from "@/components/consultora/InstalarApp";
import { PainelRepresentante } from "@/components/representante/PainelRepresentante";
import { brl, dataBR, repCobrancasLista, repConsultoras, repResumo, type FaixaCobranca } from "@/lib/representante";
import { Captacao, CobrarParcela, ContatoCobranca } from "@/components/representante/AcoesRepresentante";
import { AgendaVisitas, MaletasCarteira } from "@/components/representante/CampoRepresentante";
import { FichaConsultora } from "@/components/representante/FichaConsultora";
import { MaletasRepresentante } from "@/components/representante/MaletasRepresentante";
import { OperationalGlass } from "@/components/premium/OperationalGlass";

type Aba = "cobranca" | "consultoras" | "maletas" | "agenda" | "captacao" | "painel";
const ABAS: { id: Aba; rotulo: string; curto: string; icone: typeof Users }[] = [
  { id: "cobranca", rotulo: "Acerto e cobrança", curto: "Cobrança", icone: HandCoins },
  { id: "consultoras", rotulo: "Consultoras", curto: "Consultoras", icone: Users },
  { id: "maletas", rotulo: "Maletas e acerto", curto: "Maletas", icone: Briefcase },
  { id: "agenda", rotulo: "Agenda de visitas", curto: "Agenda", icone: CalendarDays },
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
      { property: "og:title", content: "Área do representante — LARDAN" },
      { property: "og:description", content: "Área do representante LARDAN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
    <OperationalGlass area="representante">
    <div className="representante-shell min-h-screen bg-background text-foreground md:flex">
      {!espelho && <AberturaApp />}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card p-6 md:flex">
        <img src={wordmarkAsset.url} alt="Lardan" className="mb-2 w-32" width={650} height={210} />
        <p className="brand-eyebrow mb-8">Representante</p>
        <nav className="flex flex-col gap-1">
          {ABAS.map((a) => (
            <button key={a.id} type="button" onClick={() => ir(a.id)} aria-current={aba === a.id ? "page" : undefined}
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

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-0">
        {repEspelho && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-primary px-5 py-2 text-sm text-primary-foreground md:px-10">
            <span className="flex items-center gap-2"><Eye className="size-4" /> Você está no sistema deste representante, com os mesmos números e ações (tudo fica registrado com o seu usuário).</span>
            <Link to="/admin/cadastros/pessoas/$id" params={{ id: repEspelho }} className="flex items-center gap-1 underline">
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

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {ABAS.map((a) => (
          <button key={a.id} type="button" onClick={() => ir(a.id)} aria-current={aba === a.id ? "page" : undefined}
            className={`flex min-w-0 flex-col items-center gap-1 py-3 text-[0.72rem] leading-tight ${aba === a.id ? "font-semibold text-primary" : "text-muted-foreground"}`}>
            <a.icone className="size-5" aria-hidden /> <span className="max-w-full truncate px-0.5">{a.curto}</span>
          </button>
        ))}
      </nav>
    </div>
    </OperationalGlass>
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
        {!espelho && <div className="md:hidden"><InstalarApp /></div>}
        {resumo.error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{(resumo.error as Error).message}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi rotulo="Vencido" valor={s ? brl(s.vencido_cents) : "—"} destaque />
          <Kpi rotulo="Vence hoje" valor={s ? brl(s.hoje_cents) : "—"} />
          <Kpi rotulo="Em aberto" valor={s ? brl(s.aberto_cents) : "—"} sub={s ? `${s.parcelas} parcelas · ${s.devedoras} devedoras` : ""} />
          <Kpi rotulo="Consultoras" valor={s ? String(s.consultoras) : "—"} sub={s ? `${s.ativas} ativas · ${s.maletas_campo} maletas em campo` : ""} />
        </div>
        {aba === "cobranca" && <Cobrancas rep={rep} espelho={espelho} />}
        {aba === "consultoras" && <Consultoras rep={rep} espelho={espelho} />}
        {aba === "maletas" && <div className="space-y-6"><MaletasCarteira rep={rep} /><MaletasRepresentante rep={rep} /></div>}
        {aba === "agenda" && <AgendaVisitas rep={rep} />}
        {aba === "captacao" && <Captacao rep={rep} espelho={espelho} />}
        {aba === "painel" && <PainelRepresentante rep={rep} />}
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

function Busca({ valor, set, ph }: { valor: string; set: (v: string) => void; ph: string }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
      <Search className="size-4 text-muted-foreground" />
      <input value={valor} onChange={(e) => set(e.target.value)} placeholder={ph} className="h-11 w-full bg-transparent outline-none" />
    </label>
  );
}
function useDebounce(v: string) {
  const [d, setD] = React.useState(v);
  React.useEffect(() => { const t = setTimeout(() => setD(v), 300); return () => clearTimeout(t); }, [v]);
  return d;
}

const FAIXAS: [FaixaCobranca, string][] = [
  ["vencidas", "Vencidas"], ["1_30", "1–30 dias"], ["31_60", "31–60"], ["61_90", "61–90"], ["90_mais", "+90"], ["hoje", "Hoje"], ["a_vencer", "A vencer"], ["todas", "Todas"],
];
const ROT_CONTATO: Record<string, string> = { ligacao: "ligação", whatsapp_aberto: "WhatsApp", negociacao: "negociação", anotacao: "anotação" };

function Cobrancas({ rep }: { rep: string; espelho: boolean }) {
  const [faixa, setFaixa] = React.useState<FaixaCobranca>("vencidas");
  const [ordem, setOrdem] = React.useState<"recentes" | "maior">("recentes");
  const [pagina, setPagina] = React.useState(1);
  const [texto, setTexto] = React.useState("");
  const busca = useDebounce(texto);
  const [ficha, setFicha] = React.useState<string | null>(null);
  React.useEffect(() => setPagina(1), [busca]);
  const q = useQuery({ queryKey: ["rep", rep, "cob", faixa, ordem, pagina, busca], queryFn: () => repCobrancasLista(rep, faixa, ordem, pagina, busca), placeholderData: keepPreviousData });
  const n = q.data?.faixas;
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Cobranças da carteira</h2>
        <div className="flex rounded-full border border-border p-0.5 text-xs">
          {([["recentes", "Mais recentes"], ["maior", "Maior dívida"]] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setOrdem(v); setPagina(1); }} className={`rounded-full px-3 py-1.5 ${ordem === v ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      </div>
      <Busca valor={texto} set={setTexto} ph="Buscar consultora por nome (sem acento), código ou título" />
      <Chips op={FAIXAS.map(([v, l]) => [v, n ? `${l} · ${n[v] ?? 0}` : l])} valor={faixa} set={(v) => { setFaixa(v as FaixaCobranca); setPagina(1); }} />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && q.data.itens.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma parcela neste filtro.</p>}
      {q.data && q.data.itens.length > 0 && <p className="text-xs text-muted-foreground">{q.data.total} parcela(s) · {brl(q.data.total_cents)}</p>}
      <ul className="divide-y divide-border">
        {q.data?.itens.map((c) => (
          <li key={c.installment_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <button type="button" onClick={() => setFicha(c.party_id)} className="min-w-0 flex-1 text-left">
              <p className="truncate font-medium underline-offset-2 hover:underline">{c.display_name}</p>
              <p className="text-xs text-muted-foreground">
                {c.code} · título {c.numero ?? "—"} · vence {dataBR(c.vencimento)}
                {c.atraso > 0 && <span className="font-semibold text-destructive"> · {c.atraso} dia(s) de atraso</span>}
                {c.divida_cents > c.saldo_cents && <> · dívida total {brl(c.divida_cents)}</>}
              </p>
              {(c.promessa || c.ultimo_contato) && (
                <p className="text-xs text-muted-foreground">
                  {c.promessa ? <span className="font-medium text-primary">Promessa {brl(c.promessa.valor_cents)} p/ {dataBR(c.promessa.data)}</span>
                    : c.ultimo_contato ? `Último contato: ${ROT_CONTATO[c.ultimo_contato.tipo] ?? c.ultimo_contato.tipo} em ${new Date(c.ultimo_contato.em).toLocaleDateString("pt-BR")}` : null}
                </p>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-semibold tabular-nums">{brl(c.saldo_cents)}</span>
              <ContatoCobranca c={c} parcelas={[c]} />
              <CobrarParcela c={c} rep={rep} />
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Paginas pagina={pagina} total={q.data.total} set={setPagina} />}
      <FichaConsultora party={ficha} rep={rep} onClose={() => setFicha(null)} />
    </section>
  );
}

function Consultoras({ rep }: { rep: string; espelho: boolean }) {
  const [texto, setTexto] = React.useState("");
  const busca = useDebounce(texto);
  const [filtro, setFiltro] = React.useState("todas");
  const [pagina, setPagina] = React.useState(1);
  const [ficha, setFicha] = React.useState<string | null>(null);
  React.useEffect(() => setPagina(1), [busca]);
  const q = useQuery({ queryKey: ["rep", rep, "cons", busca, filtro, pagina], queryFn: () => repConsultoras(rep, busca, filtro, pagina), placeholderData: keepPreviousData });
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 md:p-6">
      <h2 className="text-lg font-semibold">Consultoras da sua carteira</h2>
      <Busca valor={texto} set={setTexto} ph="Buscar por nome (sem acento) ou código" />
      <Chips op={[["todas", "Todas"], ["ativas", "Ativas"], ["inativas", "Inativas"], ["devedoras", "Com débito"]]} valor={filtro} set={(v) => { setFiltro(v); setPagina(1); }} />
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {q.data && q.data.itens.length === 0 && <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">Nenhuma consultora encontrada na sua carteira. Consultora de outra carteira: fale com a Lardan.</p>}
      <ul className="divide-y divide-border">
        {q.data?.itens.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => setFicha(c.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-muted/40">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.display_name}</p>
                <p className="text-xs text-muted-foreground">{c.code} · {c.cidade ?? "sem cidade"} · {c.status === "ativo" ? "ativa" : c.status === "bloqueado" ? "bloqueada" : c.status === "desligado" ? "desligada" : "inativa"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-right">
                {c.aberto_cents > 0 && (
                  <div>
                    <p className="font-semibold tabular-nums">{brl(c.aberto_cents)}</p>
                    {c.vencido_cents > 0 && <p className="text-xs text-destructive tabular-nums">{brl(c.vencido_cents)} vencido</p>}
                  </div>
                )}
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            </button>
          </li>
        ))}
      </ul>
      {q.data && <Paginas pagina={pagina} total={q.data.total} set={setPagina} />}
      <FichaConsultora party={ficha} rep={rep} onClose={() => setFicha(null)} />
    </section>
  );
}

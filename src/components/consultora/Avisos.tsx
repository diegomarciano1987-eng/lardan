import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronRight, ExternalLink, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { meusAvisos, registrarAviso, ROTULO_TIPO, type AvisoConsultora } from "@/lib/avisos";

const CHAVE = ["consultora", "avisos"];
export function useAvisos() {
  return useQuery({ queryKey: CHAVE, queryFn: meusAvisos, refetchInterval: 5 * 60_000 });
}

const dataBR = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

/* Controle compartilhado da central (aberta por qualquer botão) */
const Ctx = React.createContext<{ abrir: () => void }>({ abrir: () => {} });
export const useCentralAvisos = () => React.useContext(Ctx);

export function CentralAvisosProvider({ children }: { children: React.ReactNode }) {
  const [aberta, setAberta] = React.useState(false);
  const q = useAvisos();
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState<AvisoConsultora | null>(null);

  const ler = async (a: AvisoConsultora) => {
    setAberto(a);
    if (!a.lido) { try { await registrarAviso(a.id, false); qc.invalidateQueries({ queryKey: CHAVE }); } catch { /* leitura é opcional */ } }
  };
  const avisos = q.data ?? [];

  return (
    <Ctx.Provider value={{ abrir: () => setAberta(true) }}>
      {children}
      <Sheet open={aberta} onOpenChange={(v) => { setAberta(v); if (!v) setAberto(null); }}>
        <SheetContent side="right" className="flex w-[min(94vw,28rem)] flex-col overflow-y-auto border-l border-border bg-card px-5 pb-8 pt-6">
          <SheetHeader className="mb-4 pr-10 text-left">
            <SheetTitle className="font-display text-2xl">Novidades</SheetTitle>
            <SheetDescription className="text-base">Avisos, lançamentos e promoções da Lardan.</SheetDescription>
          </SheetHeader>
          {aberto ? (
            <article className="space-y-4">
              <button type="button" className="admin-btn min-h-11" onClick={() => setAberto(null)}>← Todas as novidades</button>
              {aberto.imagem_url && <img src={aberto.imagem_url} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover" />}
              <p className="text-sm font-medium text-primary">{ROTULO_TIPO[aberto.tipo]} · {dataBR(aberto.inicio_em)}</p>
              <h3 className="font-display text-2xl leading-tight">{aberto.titulo}</h3>
              <p className="whitespace-pre-line text-[1.05rem] leading-relaxed">{aberto.corpo}</p>
              {aberto.link_url && (
                <a href={aberto.link_url} target="_blank" rel="noopener noreferrer" className="btn-app-principal w-full">
                  {aberto.link_rotulo || "Saiba mais"} <ExternalLink className="size-4" aria-hidden />
                </a>
              )}
            </article>
          ) : q.isLoading ? (
            <p role="status" className="text-base text-muted-foreground">Carregando…</p>
          ) : q.isError ? (
            <p role="alert" className="text-base">Não foi possível carregar. <button className="underline" onClick={() => q.refetch()}>Tentar de novo</button></p>
          ) : avisos.length === 0 ? (
            <p className="rounded-2xl border border-border p-5 text-base">Nenhuma novidade no momento.</p>
          ) : (
            <ul className="space-y-3">
              {avisos.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => void ler(a)}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted">
                    {a.imagem_url
                      ? <img src={a.imagem_url} alt="" className="size-16 shrink-0 rounded-xl object-cover" />
                      : <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{a.critico ? <ShieldAlert className="size-6" /> : <Sparkles className="size-6" />}</span>}
                    <span className="min-w-0">
                      <span className="block text-xs font-medium uppercase tracking-wide text-primary">{a.critico ? "Aviso importante" : ROTULO_TIPO[a.tipo]}</span>
                      <span className="block truncate text-base font-semibold">{a.titulo}</span>
                      <span className="block text-sm text-muted-foreground">{dataBR(a.inicio_em)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {!a.lido && <span className="size-2.5 rounded-full bg-acao" aria-label="Não lida" />}
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
      <AvisoCritico avisos={avisos} />
    </Ctx.Provider>
  );
}

/** Botão compacto do topo (celular): "Novidades" + sino com contador. */
export function BotaoNovidades() {
  const { abrir } = useCentralAvisos();
  const n = (useAvisos().data ?? []).filter((a) => !a.lido).length;
  return (
    <button type="button" onClick={abrir} aria-label={n ? `Novidades, ${n} não lidas` : "Novidades"}
      className="relative inline-flex h-12 items-center gap-2 rounded-full border border-border bg-background px-4 text-[0.95rem] font-medium text-foreground transition-colors hover:bg-muted">
      <Bell className="size-5 text-primary" aria-hidden />
      Novidades
      {n > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-acao px-1.5 text-xs font-semibold text-acao-foreground">{n}</span>}
    </button>
  );
}

/** Cartão de destaque (computador), acima dos atalhos. */
export function CartaoNovidades() {
  const { abrir } = useCentralAvisos();
  const avisos = useAvisos().data ?? [];
  const n = avisos.filter((a) => !a.lido).length;
  const ultimo = avisos[0];
  return (
    <button type="button" onClick={abrir}
      className="group relative hidden w-full overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-r from-primary/12 via-card to-card p-0 text-left shadow-[var(--shadow-app)] transition-transform active:scale-[0.995] lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      {ultimo?.imagem_url
        ? <img src={ultimo.imagem_url} alt="" className="h-28 w-40 object-cover" />
        : <span className="grid h-28 w-28 place-items-center text-primary"><Bell className="size-9" aria-hidden /></span>}
      <span className="min-w-0 px-6 py-4">
        <span className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.14em] text-primary">
          <Sparkles className="size-4" aria-hidden /> Novidades {n > 0 && <span className="rounded-full bg-acao px-2 py-0.5 text-xs normal-case tracking-normal text-acao-foreground">{n} nova{n > 1 ? "s" : ""}</span>}
        </span>
        <span className="mt-1 block truncate font-display text-2xl">{ultimo ? ultimo.titulo : "Nenhuma novidade no momento"}</span>
        <span className="block truncate text-base text-muted-foreground">{ultimo ? ultimo.corpo : "Quando a Lardan publicar avisos e promoções, eles aparecem aqui."}</span>
      </span>
      <span className="mr-6 inline-flex items-center gap-1 text-base font-semibold text-acao">Ver todas <ChevronRight className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
    </button>
  );
}

/** Pop-up obrigatório para avisos críticos ainda sem "Ciente". */
function AvisoCritico({ avisos }: { avisos: AvisoConsultora[] }) {
  const qc = useQueryClient();
  const pendente = avisos.find((a) => a.critico && !a.ciente);
  const [enviando, setEnviando] = React.useState(false);
  if (!pendente) return null;
  const confirmar = async () => {
    setEnviando(true);
    try { await registrarAviso(pendente.id, true); await qc.invalidateQueries({ queryKey: CHAVE }); toast.success("Ciência registrada."); }
    catch { toast.error("Não registrou. Verifique sua internet e tente de novo."); }
    finally { setEnviando(false); }
  };
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="aviso-critico-t" className="fixed inset-0 z-[100] grid place-items-end bg-foreground/55 p-0 backdrop-blur-sm sm:place-items-center sm:p-6">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-card pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-3xl">
        {pendente.imagem_url && <img src={pendente.imagem_url} alt="" className="aspect-[16/9] w-full object-cover" />}
        <div className="space-y-4 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-destructive"><ShieldAlert className="size-5" aria-hidden /> Aviso importante</p>
          <h2 id="aviso-critico-t" className="font-display text-2xl leading-tight sm:text-3xl">{pendente.titulo}</h2>
          <p className="whitespace-pre-line text-[1.05rem] leading-relaxed">{pendente.corpo}</p>
          {pendente.link_url && <a href={pendente.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-base font-medium text-acao underline">{pendente.link_rotulo || "Saiba mais"} <ExternalLink className="size-4" aria-hidden /></a>}
          <button type="button" disabled={enviando} onClick={() => void confirmar()} className="btn-app-principal w-full">
            {enviando ? "Registrando…" : "Ciente"}
          </button>
          <p className="text-center text-sm text-muted-foreground">Sua confirmação fica registrada com data e hora.</p>
        </div>
      </div>
    </div>
  );
}

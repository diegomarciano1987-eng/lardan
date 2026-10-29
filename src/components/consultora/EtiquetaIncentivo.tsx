/**
 * 0182 — Etiqueta premium "Você pode ganhar R$ X" fixa no topo do app da consultora (celular e computador) e o
 * painel de incentivo em tela cheia que ela abre. Só aparece com maleta aceita. Substitui a faixa "Meta de vendas"
 * e o card "Vendas da maleta" do início, que agora moram dentro do painel.
 * Números: consultora_incentivo (banco). Estimativa; o valor oficial sai no acerto.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChartColumnBig, ChevronRight, Percent, Plus, Sparkles, Target, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brl } from "@/lib/maletas";
import { mesCurto } from "@/lib/historico-vendas";
import { diasAte, incentivoQuery, posicao, type Incentivo } from "@/lib/incentivo";
import { TabelaComissao } from "@/components/consultora/GanhosConsultora";

type ComMaleta = Extract<Incentivo, { maleta: true }>;
type Ir = (n: { aba: "novo" | "vendas" }) => void;

const pct = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString("pt-BR")}%`;
const dataBR = (s: string) => s.slice(0, 10).split("-").reverse().join("/");

/** Barra fina no topo: alvo à esquerda, etiqueta verde à direita. Fica fixa ao rolar. */
export function BarraIncentivo({ ir }: { ir: Ir }) {
  const q = useQuery(incentivoQuery());
  const [aberto, setAberto] = React.useState(false);
  const d = q.data;
  if (!d || !d.maleta) return null;
  const o = d.objetivo;
  const meta = o?.tipo !== "objetivo";
  const vendidoPct = d.valor_maleta_cents > 0 ? Math.min(100, (d.vendido_cents / d.valor_maleta_cents) * 100) : 0;
  return (
    <>
      <div className="incentivo-barra sticky top-0 z-30 -mx-4 mb-5 border-b border-border bg-background/92 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setAberto(true)} className="min-w-0 flex-1 text-left" aria-label="Abrir meu painel de ganhos">
            <span className="flex items-center gap-1.5 text-[0.8rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Target className="size-3.5 shrink-0" aria-hidden /> {meta ? "Meta mínima" : <>Objetivo<span className="hidden sm:inline"> de venda</span></>}
            </span>
            <strong className="block text-[1.35rem] leading-tight tabular-nums">{o?.objetivo_cents ? brl(o.objetivo_cents) : brl(d.valor_maleta_cents)}</strong>
            <span className="mt-1 block h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-success" style={{ width: `${vendidoPct}%` }} />
            </span>
          </button>
          <button type="button" onClick={() => setAberto(true)} className="etiqueta-ganho" aria-haspopup="dialog" aria-expanded={aberto}>
            <Sparkles className="size-4 shrink-0" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block text-[0.78rem] font-medium opacity-90">Você pode ganhar</span>
              <strong className="block text-[1.15rem] tabular-nums">{brl(d.comissao_maleta_cents)}</strong>
            </span>
            <ChevronRight className="size-4 shrink-0 opacity-80" aria-hidden />
          </button>
        </div>
      </div>
      <PainelIncentivo d={d} aberto={aberto} fechar={() => setAberto(false)} ir={(n) => { setAberto(false); ir(n); }} />
    </>
  );
}

function Marco({ cor, rotulo, valor, detalhe }: { cor: string; rotulo: string; valor: string; detalhe?: string | undefined }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`size-3 shrink-0 rounded-full ${cor}`} aria-hidden />
      <span className="min-w-0 flex-1 text-[1rem]">{rotulo}{detalhe ? <span className="text-muted-foreground"> · {detalhe}</span> : null}</span>
      <strong className="text-[1.05rem] tabular-nums">{valor}</strong>
    </li>
  );
}

function Bloco({ icone: Icone, titulo, children, destaque = false }: { icone: typeof Wallet; titulo: string; children: React.ReactNode; destaque?: boolean }) {
  return (
    <section className={`rounded-3xl border p-5 ${destaque ? "border-success/40 bg-success/10" : "border-border bg-card"}`}>
      <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold"><Icone className={`size-5 ${destaque ? "text-success" : "text-primary"}`} aria-hidden /> {titulo}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Painel em tela cheia: desliza da direita para a esquerda. */
export function PainelIncentivo({ d, aberto, fechar, ir }: { d: ComMaleta; aberto: boolean; fechar: () => void; ir: Ir }) {
  const [tabela, setTabela] = React.useState(false);
  const [festa, setFesta] = React.useState(false);
  const o = d.objetivo;
  const meta = o?.tipo !== "objetivo";
  const total = d.valor_maleta_cents;
  const vendidoPct = total > 0 ? Math.min(100, (d.vendido_cents / total) * 100) : 0;
  const pProx = d.proxima ? posicao(d.proxima.min_cents, total) : null;
  const pObj = o?.objetivo_cents ? posicao(o.objetivo_cents, total) : null;
  const faltam = d.acerto ? diasAte(d.hoje, d.acerto) : null;

  // Comemoração curta, uma vez por maleta neste aparelho, quando o objetivo é batido.
  React.useEffect(() => {
    if (!aberto || !d.objetivo_batido) return;
    const chave = `lardan-objetivo-batido-${d.cycle_id}`;
    try { if (localStorage.getItem(chave)) return; localStorage.setItem(chave, "1"); } catch { /* sem armazenamento: mostra mesmo assim */ }
    setFesta(true);
    const t = window.setTimeout(() => setFesta(false), 2600);
    return () => window.clearTimeout(t);
  }, [aberto, d.objetivo_batido, d.cycle_id]);

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="right" className="painel-incentivo flex w-full flex-col gap-0 overflow-hidden border-l-0 p-0 sm:max-w-none [&>button:first-child]:top-[calc(0.5rem+env(safe-area-inset-top))] [&>button:first-child]:z-10 [&>button:first-child]:bg-white/10 [&>button:first-child]:text-white">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SheetHeader className="space-y-0 bg-[#2B201C] px-5 pb-6 pt-[calc(1.25rem+env(safe-area-inset-top))] text-left text-white sm:px-8">
            <div className="mx-auto w-full max-w-3xl">
            <SheetTitle className="pr-12 text-[0.85rem] font-semibold uppercase tracking-[0.2em] text-[#E9D9CC]">
              {d.kits > 1 ? `Sua remessa · ${d.kits} kits` : "Sua maleta"}
            </SheetTitle>
            <SheetDescription className="mt-1 flex items-center gap-2 text-[1rem] text-[#F1E3D7]">
              <CalendarClock className="size-4 shrink-0" aria-hidden />
              {d.acerto ? <>Acerto em {dataBR(d.acerto)}{faltam != null ? (faltam > 0 ? ` · faltam ${faltam} ${faltam === 1 ? "dia" : "dias"}` : faltam === 0 ? " · é hoje" : " · vencido") : ""}</> : "Data do acerto a combinar"}
            </SheetDescription>
            <div className="mt-5">
              <span className="block text-[1rem] text-[#F1E3D7]">Vendendo a maleta inteira, você ganha</span>
              <strong className="mt-1 block font-display text-[3.2rem] font-medium leading-none text-[#7FE0AE] tabular-nums">{brl(d.comissao_maleta_cents)}</strong>
              <span className="mt-2 block text-[0.98rem] text-[#E9D9CC]">{pct(d.percentual_maleta)} sobre {brl(total)} · {d.pecas_total} {d.pecas_total === 1 ? "peça" : "peças"}</span>
            </div>
            </div>
          </SheetHeader>

          <div className="mx-auto max-w-3xl space-y-4 px-5 py-6 sm:px-8">
            {/* A barra grande com os marcos */}
            <section aria-label="Quanto você já vendeu da maleta" className="rounded-3xl border border-border bg-card p-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[1rem] text-muted-foreground">Vendido e pago</span>
                <strong className="text-[1.6rem] tabular-nums">{brl(d.vendido_cents)}</strong>
              </div>
              <div className="relative mt-4 h-6 rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(d.vendido_cents, total)}
                aria-valuetext={`${brl(d.vendido_cents)} vendidos de ${brl(total)}`}>
                <div className="incentivo-preenchimento h-full rounded-full" style={{ width: `${vendidoPct}%` }} />
                {pProx != null && <span className="absolute -top-1.5 h-9 w-0.5 rounded bg-foreground/45" style={{ left: `${pProx}%` }} aria-hidden />}
                {pObj != null && <span className="absolute -top-2 h-10 w-1 -translate-x-1/2 rounded bg-primary" style={{ left: `${pObj}%` }} aria-hidden />}
              </div>
              <div className="mt-2 flex justify-between text-[0.95rem] tabular-nums text-muted-foreground"><span>{brl(0)}</span><span>{brl(total)}</span></div>
              <ul className="mt-4 space-y-2.5">
                <Marco cor="bg-success" rotulo="Vendido até agora" valor={brl(d.vendido_cents)} detalhe={`${d.pecas_vendidas}/${d.pecas_total} peças`} />
                {d.proxima && <Marco cor="bg-foreground/45" rotulo="Próxima faixa" valor={brl(d.proxima.min_cents)} detalhe={pct(d.proxima.percentual)} />}
                {o?.objetivo_cents ? <Marco cor="bg-primary" rotulo={meta ? "Meta mínima" : "Seu objetivo"} valor={brl(o.objetivo_cents)} detalhe={pObj == null ? "maior que esta maleta" : undefined} /> : null}
                <Marco cor="bg-[#7FE0AE] ring-1 ring-success" rotulo="Maleta inteira" valor={brl(total)} />
              </ul>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <Bloco icone={Wallet} titulo="Já é seu" destaque>
                <strong className="block text-[2rem] leading-tight text-success tabular-nums">{brl(d.comissao_cents)}</strong>
                <span className="block text-[0.98rem] text-muted-foreground">
                  {d.faixa ? `comissão de ${pct(d.faixa.percentual)} sobre o que você já vendeu e recebeu` : "venda a primeira peça para começar a ganhar"}
                </span>
              </Bloco>

              <Bloco icone={TrendingUp} titulo="Próximo degrau">
                {d.proxima ? (
                  <>
                    <span className="block text-[1.05rem]">Faltam <strong className="tabular-nums">{brl(d.proxima.falta_cents)}</strong> para subir para <strong>{pct(d.proxima.percentual)}</strong>.</span>
                    {d.proxima_ganho_extra_cents != null && d.proxima_ganho_extra_cents > 0 && (
                      <span className="mt-1 block text-[1.05rem] text-success">Chegando lá, você ganha <strong className="tabular-nums">{brl(d.proxima_ganho_extra_cents)}</strong> a mais — a faixa vale sobre tudo.</span>
                    )}
                  </>
                ) : <span className="block text-[1.05rem]">Você está na faixa mais alta. Cada venda agora rende {pct(d.faixa?.percentual)}.</span>}
              </Bloco>

              {o?.objetivo_cents ? (
                <Bloco icone={d.objetivo_batido ? Trophy : Target} titulo={d.objetivo_batido ? "Objetivo batido!" : meta ? "Sua meta mínima" : "Seu objetivo"} destaque={d.objetivo_batido}>
                  <strong className="block text-[1.8rem] leading-tight tabular-nums">{brl(o.objetivo_cents)}</strong>
                  {d.objetivo_batido
                    ? <span className="block text-[1.02rem]">Parabéns! Agora é ir para a próxima faixa e para a maleta inteira.</span>
                    : <span className="block text-[1.02rem]">Faltam <strong className="tabular-nums">{brl(d.objetivo_falta_cents ?? 0)}</strong>{o.comissao_objetivo_cents ? <> · cumprindo, você ganha <strong className="text-success tabular-nums">{brl(o.comissao_objetivo_cents)}</strong></> : null}</span>}
                  {meta && !d.objetivo_batido && <span className="mt-1 block text-[0.95rem] text-muted-foreground">Venda mínima do ciclo para receber a próxima maleta.</span>}
                </Bloco>
              ) : null}

              <Bloco icone={Sparkles} titulo="Maleta inteira">
                <strong className="block text-[1.8rem] leading-tight text-success tabular-nums">{brl(d.comissao_maleta_cents)}</strong>
                <span className="block text-[1.02rem] text-muted-foreground">é o que você ganha vendendo as {d.pecas_total} peças ({pct(d.percentual_maleta)}).</span>
              </Bloco>
            </div>

            {o && o.tipo === "objetivo" && o.meses.length > 0 && (
              <section className="rounded-3xl border border-border bg-card p-5">
                <h3 className="text-[1.05rem] font-semibold">{o.meses.length === 1 ? "Seu melhor mês" : `Seus ${o.meses.length} melhores meses`}</h3>
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {o.meses.slice(-3).map((m) => (
                    <li key={m.mes} className="rounded-2xl bg-muted/50 px-3 py-3">
                      <span className="block text-[0.85rem] uppercase tracking-[0.12em] text-muted-foreground">{mesCurto(m.mes)}</span>
                      {m.acerto
                        ? <><strong className="block text-[1.05rem] tabular-nums">{brl(m.vendido_cents ?? 0)}</strong><span className="block text-[0.9rem] text-success tabular-nums">+{brl(m.comissao_cents ?? 0)}</span></>
                        : <span className="block text-[0.95rem] text-muted-foreground">sem acerto</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => ir({ aba: "vendas" })} className="admin-btn min-h-13 justify-center text-base"><ChartColumnBig className="size-5" aria-hidden /> Meu histórico de vendas</button>
              <button type="button" onClick={() => setTabela(true)} className="admin-btn min-h-13 justify-center text-base"><Percent className="size-5" aria-hidden /> Minha tabela de comissão</button>
            </div>
            <p className="pb-2 text-[0.92rem] text-muted-foreground">Estimativa com as vendas pagas no app. O valor oficial sai no acerto feito pela LARDAN.</p>
          </div>
        </div>
        <div className="border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
          <button type="button" onClick={() => ir({ aba: "novo" })} className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-center gap-3 rounded-2xl bg-acao text-[1.15rem] font-semibold text-acao-foreground active:scale-[0.99]">
            <Plus className="size-6" aria-hidden /> Nova venda
          </button>
        </div>
        {festa && <div className="incentivo-festa" aria-hidden><span /><span /><span /><span /><span /><span /><span /><span /></div>}
        <TabelaComissao aberta={tabela} fechar={() => setTabela(false)} />
      </SheetContent>
    </Sheet>
  );
}

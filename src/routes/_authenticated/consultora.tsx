import * as React from "react";
import { Movimentacoes } from "@/components/admin/maletas/Movimentacoes";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, PackageCheck, ShoppingBag, Store } from "lucide-react";
import { toast } from "sonner";
import { Estudio } from "@/components/vitrine/Estudio";
import { CascaConsultora, Clientes, FichaCliente, FormCliente, Inicio, Mais, NovoPedido, Topo, type AbaApp, type Ir, type Nav } from "@/components/consultora/AppConsultora";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoNaoLiberado } from "@/components/site/AcessoNaoLiberado";
import { fetchMyRoles } from "@/lib/session";
import { portaLiberada } from "@/lib/portas";
import {
  SITUACAO_MALETA,
  SITUACAO_PEDIDO,
  aceitar,
  brl,
  chaveIdempotencia,
  confirmarEntrega,
  detalheMaleta,
  imagem,
  listarMaletas,
  listarPedidos,
  mudarSituacaoPedido,
  publicarPeca,
  traduzir,
  type TipoDivergencia,
} from "@/lib/maletas";

const ABAS_VALIDAS: AbaApp[] = ["inicio", "clientes", "pedidos", "maleta", "vitrine", "historico", "mais", "novo"];
const str = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length < 200 ? v : undefined);

export const Route = createFileRoute("/_authenticated/consultora")({
  validateSearch: (s: Record<string, unknown>): { aba?: AbaApp | undefined; id?: string | undefined; modo?: "nova" | "editar" | undefined; q?: string | undefined } => ({
    aba: ABAS_VALIDAS.includes(s["aba"] as AbaApp) ? (s["aba"] as AbaApp) : undefined,
    id: str(s["id"]),
    modo: s["modo"] === "nova" || s["modo"] === "editar" ? s["modo"] : undefined,
    q: str(s["q"]),
  }),
  component: AreaConsultora,
  head: () => ({
    meta: [
      { title: "Minha área — Consultora LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#1c1614" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "LARDAN" },
    ],
    // Atalho instalável existe só na área da consultora.
    links: [
      { rel: "manifest", href: "/consultora.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/consultora-apple-180.png" },
    ],
  }),
});

type Aba = "maleta" | "vitrine" | "pedidos" | "historico";

const ABAS: { id: Aba; rotulo: string; icone: typeof Store }[] = [
  { id: "maleta", rotulo: "Minha maleta", icone: BriefcaseBusiness },
  { id: "vitrine", rotulo: "Minha vitrine", icone: Store },
  { id: "pedidos", rotulo: "Pedidos", icone: ShoppingBag },
  { id: "historico", rotulo: "Entregas", icone: PackageCheck },
];

function Cartao({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line-soft bg-surface p-5 ${className}`}>{children}</section>;
}

/* ---------------- maleta ---------------- */
function MinhaMaleta({ cycleId }: { cycleId: string | null }) {
  const qc = useQueryClient();
  const [divergencias, setDivergencias] = React.useState<Record<string, number>>({});
  const [tipos, setTipos] = React.useState<Record<string, TipoDivergencia>>({});
  const [motivos, setMotivos] = React.useState<Record<string, string>>({});
  const [chave] = React.useState(chaveIdempotencia);

  const ficha = useQuery({
    queryKey: ["consultora", "maleta", cycleId],
    queryFn: () => detalheMaleta(cycleId!),
    enabled: !!cycleId,
  });
  const recarregar = () => qc.invalidateQueries({ queryKey: ["consultora"] });

  const confirmar = useMutation({
    mutationFn: (transfer: string) => confirmarEntrega(transfer),
    onSuccess: () => {
      toast.success("Recebimento confirmado.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const aceite = useMutation({
    mutationFn: () => {
      const itens = (ficha.data?.composicao ?? []).map((c) => {
        const div = Math.min(Math.max(divergencias[c.variant_id] ?? 0, 0), c.quantidade);
        const tipo = tipos[c.variant_id] ?? "faltante";
        return {
          variant_id: c.variant_id,
          qty_accepted: c.quantidade - div,
          qty_divergent: div,
          ...(div > 0
            ? {
                tipo_divergencia: tipo,
                motivo:
                  motivos[c.variant_id]?.trim() ||
                  (tipo === "faltante" ? "Peça não veio na maleta" : "Peça recebida com defeito"),
              }
            : {}),
        };
      });
      return aceitar(cycleId!, itens, chave);
    },
    onSuccess: (r) => {
      toast.success(r.repetida ? "Aceite já registrado." : "Aceite registrado. Suas peças já estão liberadas.");
      recarregar();
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const publicar = useMutation({
    mutationFn: (v: { variant: string; publicar: boolean }) => publicarPeca(cycleId!, v.variant, v.publicar),
    onSuccess: () => recarregar(),
    onError: (e) => toast.error(traduzir(e)),
  });

  if (!cycleId) {
    return (
      <Cartao>
        <p className="font-semibold">Nenhuma maleta com você no momento.</p>
        <p className="mt-1 text-sm text-ledger-muted">
          Assim que a matriz expedir uma maleta para o seu nome, ela aparece aqui para conferência.
        </p>
      </Cartao>
    );
  }
  if (ficha.isLoading) return <Cartao>Carregando sua maleta…</Cartao>;
  if (ficha.isError) return <Cartao>{traduzir(ficha.error)}</Cartao>;

  const d = ficha.data!;
  const s = SITUACAO_MALETA[d.ciclo.status];
  const aguardandoRecebimento = d.entregas.find(
    (t) => t.situacao === "transito" && t.para_party_id === d.ciclo.consultora_party_id,
  );
  const precisaAceitar = d.ciclo.status === "transito" || d.ciclo.status === "recebida";

  return (
    <div className="space-y-4">
      <Cartao>
        <p className="text-xs uppercase tracking-widest text-ledger-muted">
          Maleta {d.maleta.codigo} · ciclo {d.ciclo.cycle_no}
        </p>
        <p className="mt-1 text-2xl font-semibold">{s?.rotulo ?? d.ciclo.status}</p>
        <p className="mt-1 text-sm text-ledger-muted">
          {d.ciclo.quantity_total} peças · valor de referência {brl(Number(d.ciclo.reference_total_cents ?? 0))}
        </p>
        <p className="mt-3 text-xs text-ledger-muted">
          Valor de referência é o preço de varejo das peças. Não é dívida sua: as regras de acerto ainda
          não estão ativas.
        </p>
      </Cartao>

      {aguardandoRecebimento && (
        <Cartao className="border-warning">
          <p className="font-semibold">Sua maleta chegou?</p>
          <p className="mt-1 text-sm text-ledger-muted">Confirme o recebimento para depois conferir peça por peça.</p>
          <button
            type="button"
            className="admin-btn admin-btn-primary mt-3 w-full"
            onClick={() => confirmar.mutate(aguardandoRecebimento.id)}
          >
            Confirmar recebimento
          </button>
        </Cartao>
      )}

      {precisaAceitar && (
        <Cartao>
          <p className="font-semibold">Conferência</p>
          <p className="mt-1 text-sm text-ledger-muted">
            Toda peça precisa ser classificada: o que você não informar como faltante ou com defeito
            é registrado como recebido em ordem.
          </p>
          <div className="mt-4 space-y-4">
            {d.composicao.map((c) => {
              const div = Math.min(Math.max(divergencias[c.variant_id] ?? 0, 0), c.quantidade);
              return (
                <div key={c.variant_id} className="space-y-2 border-b border-line-soft pb-3 last:border-0">
                  <div className="flex items-center gap-3">
                    {imagem(c.media_id) ? (
                      <img src={imagem(c.media_id)!} alt="" className="size-14 rounded-xl object-cover" />
                    ) : (
                      <div className="size-14 rounded-xl bg-surface-muted" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold leading-snug">{c.produto}</p>
                      <p className="text-[0.95rem] text-ledger-muted">
                        {c.variante ?? "Sem variação"} · enviadas {c.quantidade} · aceitas {c.quantidade - div}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-[0.95rem]">Unidades com problema</span>
                    <div className="flex items-center gap-2" role="group" aria-label={`Unidades com problema de ${c.produto}`}>
                      <button type="button" className="admin-btn size-12 justify-center p-0 text-xl" aria-label="Diminuir"
                        disabled={div <= 0}
                        onClick={() => setDivergencias((v) => ({ ...v, [c.variant_id]: Math.max(0, div - 1) }))}>−</button>
                      <span className="w-10 text-center text-xl font-semibold num" aria-live="polite">{div}</span>
                      <button type="button" className="admin-btn size-12 justify-center p-0 text-xl" aria-label="Aumentar"
                        disabled={div >= c.quantidade}
                        onClick={() => setDivergencias((v) => ({ ...v, [c.variant_id]: Math.min(c.quantidade, div + 1) }))}>+</button>
                    </div>
                  </div>
                  {div > 0 && (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={`Tipo da divergência de ${c.produto}`}>
                        {([["faltante", "Não veio na maleta"], ["defeito", "Veio com defeito"]] as const).map(([v, r]) => {
                          const sel = (tipos[c.variant_id] ?? "faltante") === v;
                          return (
                            <button key={v} type="button" role="radio" aria-checked={sel}
                              onClick={() => setTipos((t) => ({ ...t, [c.variant_id]: v as TipoDivergencia }))}
                              className={`min-h-12 rounded-xl border px-3 text-[0.95rem] font-medium ${sel ? "border-ink bg-ink text-warm-ivory" : "border-line bg-surface"}`}>
                              {sel ? "✓ " : ""}{r}
                            </button>
                          );
                        })}
                      </div>
                      <label className="grid gap-1">
                        <span className="text-[0.95rem] font-medium">O que aconteceu?</span>
                        <input
                          className="admin-input"
                          autoComplete="off"
                          placeholder="Ex.: veio sem o fecho"
                          value={motivos[c.variant_id] ?? ""}
                          onChange={(e) => setMotivos((v) => ({ ...v, [c.variant_id]: e.target.value }))}
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="admin-btn admin-btn-primary mt-4 w-full"
            disabled={aceite.isPending}
            onClick={() => aceite.mutate()}
          >
            {aceite.isPending ? "Registrando…" : "Aceitar maleta"}
          </button>
        </Cartao>
      )}

      {d.saldos.length > 0 && (
        <Cartao>
          <p className="font-semibold">Minhas peças</p>
          <div className="mt-4 space-y-3">
            {d.saldos.map((b) => (
              <div key={b.variant_id} className="flex items-center gap-3">
                {imagem(b.media_id) ? (
                  <img src={imagem(b.media_id)!} alt="" className="size-14 rounded-xl object-cover" />
                ) : (
                  <div className="size-14 rounded-xl bg-surface-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{b.produto}</p>
                  <p className="text-xs text-ledger-muted">
                    disponível {b.disponivel} · reservadas {b.reservado}
                    {b.divergente > 0 ? ` · divergentes ${b.divergente}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => publicar.mutate({ variant: b.variant_id, publicar: !b.publicado })}
                >
                  {b.publicado ? "Na vitrine" : "Oculta"}
                </button>
              </div>
            ))}
          </div>
        </Cartao>
      )}

      <Movimentacoes
        cycleId={cycleId}
        nomes={Object.fromEntries([
          ...d.composicao.map((c) => [c.variant_id, `${c.produto}${c.variante ? ` · ${c.variante}` : ""}`] as const),
          ...d.saldos.map((b) => [b.variant_id, `${b.produto}${b.variante ? ` · ${b.variante}` : ""}`] as const),
        ])}
        podeGerir={false}
        podeAcrescentar={false}
      />
    </div>
  );
}

/* ---------------- pedidos ---------------- */
function Pedidos() {
  const qc = useQueryClient();
  const pedidos = useQuery({ queryKey: ["consultora", "pedidos"], queryFn: () => listarPedidos() });
  const mudar = useMutation({
    mutationFn: (v: { id: string; status: string }) => mudarSituacaoPedido(v.id, v.status),
    onSuccess: () => {
      toast.success("Pedido atualizado.");
      void qc.invalidateQueries({ queryKey: ["consultora"] });
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  if (pedidos.isLoading) return <Cartao>Carregando pedidos…</Cartao>;
  if (pedidos.isError) return <Cartao>{traduzir(pedidos.error)}</Cartao>;
  if ((pedidos.data ?? []).length === 0) {
    return (
      <Cartao>
        <p className="font-semibold">Nenhum pedido ainda</p>
        <p className="mt-1 text-sm text-ledger-muted">
          Quando uma cliente enviar um pedido pela sua vitrine, ele aparece aqui na hora.
        </p>
      </Cartao>
    );
  }

  return (
    <div className="space-y-3">
      {pedidos.data!.map((p) => {
        const s = SITUACAO_PEDIDO[p.status];
        return (
          <Cartao key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{p.customer_name}</p>
                <p className="text-xs text-ledger-muted">
                  {p.code} · {p.items_count} peça(s) · {brl(Number(p.subtotal_cents))}
                </p>
              </div>
              <span className="rounded-lg border border-line px-2 py-1 text-[0.7rem] uppercase tracking-widest">
                {s?.rotulo ?? p.status}
              </span>
            </div>
            {p.customer_phone && (
              <a
                className="admin-btn mt-3 inline-flex"
                href={`https://wa.me/55${p.customer_phone}`}
                target="_blank"
                rel="noreferrer"
              >
                Falar no WhatsApp
              </a>
            )}
            {p.status !== "concluido" && p.status !== "cancelado" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => mudar.mutate({ id: p.id, status: "em_atendimento" })}
                >
                  Atendendo
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => mudar.mutate({ id: p.id, status: "aguardando_pagamento" })}
                >
                  Aguardando pagamento
                </button>
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => mudar.mutate({ id: p.id, status: "cancelado" })}
                >
                  Cancelar e devolver peças
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-ledger-muted">
              Pedido é intenção de compra. Nenhum pagamento é registrado aqui enquanto o financeiro não
              estiver conectado.
            </p>
          </Cartao>
        );
      })}
    </div>
  );
}

/* ---------------- histórico ---------------- */
function Historico({ cycleId }: { cycleId: string | null }) {
  const ficha = useQuery({
    queryKey: ["consultora", "maleta", cycleId],
    queryFn: () => detalheMaleta(cycleId!),
    enabled: !!cycleId,
  });
  if (!cycleId) return <Cartao>Sem histórico ainda.</Cartao>;
  if (ficha.isLoading) return <Cartao>Carregando…</Cartao>;
  const d = ficha.data;
  return (
    <div className="space-y-3">
      <Cartao>
        <p className="font-semibold">Entregas</p>
        {(d?.entregas ?? []).map((t) => (
          <p key={t.id} className="mt-2 text-sm text-ledger-muted">
            #{t.seq} {t.de ?? "Matriz"} → {t.para ?? "—"} · {t.situacao}
          </p>
        ))}
      </Cartao>
      <Cartao>
        <p className="font-semibold">Divergências</p>
        {(d?.saldos ?? []).filter((b) => b.divergente > 0).length === 0 ? (
          <p className="mt-1 text-sm text-ledger-muted">Nenhuma divergência registrada.</p>
        ) : (
          (d?.saldos ?? [])
            .filter((b) => b.divergente > 0)
            .map((b) => (
              <p key={b.variant_id} className="mt-2 text-sm text-ledger-muted">
                {b.produto} · {b.divergente} un em divergência
              </p>
            ))
        )}
      </Cartao>
    </div>
  );
}

function AreaConsultora() {
  const { data: roles, isLoading } = useQuery({ queryKey: ["my-roles"], queryFn: fetchMyRoles });
  if (isLoading) return null;
  if (!portaLiberada("consultora", roles ?? [])) return <AcessoNaoLiberado />;
  return <AreaConsultoraLiberada />;
}

function AreaConsultoraLiberada() {
  const nav = Route.useSearch() as Nav;
  const navigate = Route.useNavigate();
  const ir: Ir = (n) => {
    const busca = n.q !== undefined || n.aba === nav.aba;
    navigate({ search: { aba: n.aba, id: n.id, modo: n.modo, q: n.q }, replace: busca && n.aba === nav.aba && !n.id && !nav.id && !n.modo });
    if (!(n.aba === nav.aba && n.q !== nav.q)) window.scrollTo({ top: 0 });
  };
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const maletas = useQuery({ queryKey: ["consultora", "maletas"], queryFn: () => listarMaletas() });
  const abertas = (maletas.data ?? []).filter((m) => !["encerrada", "cancelada"].includes(m.situacao));
  const valida = escolhida && abertas.some((m) => m.cycle_id === escolhida) ? escolhida : null;
  const atual = valida ?? abertas[0]?.cycle_id ?? null;
  const aba = nav.aba ?? "inicio";
  const ajuda = aba === "historico" ? "maleta" : aba === "novo" ? "pedidos" : aba;

  const seletorMaleta = abertas.length > 1 && (
    <div role="radiogroup" aria-label="Maleta em uso" className="mb-5 grid gap-2">
      <span className="text-[1.05rem] font-semibold">Maleta em uso</span>
      {abertas.map((m) => {
        const sel = m.cycle_id === atual;
        return (
          <button key={m.cycle_id} type="button" role="radio" aria-checked={sel} onClick={() => setEscolhida(m.cycle_id)}
            className={`flex min-h-12 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-base ${sel ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
            <span>{m.codigo} · ciclo {m.ciclo}</span>
            <span className="text-[0.95rem]">{sel ? "✓ Em uso" : (SITUACAO_MALETA[m.situacao]?.rotulo ?? m.situacao)}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <CascaConsultora nav={{ ...nav, aba }} ir={ir} ajuda={ajuda}>
      <Passeio />
      {aba === "inicio" && <Inicio ir={ir} />}
      {aba === "clientes" && (nav.modo ? <FormCliente id={nav.modo === "editar" ? nav.id : undefined} ir={ir} />
        : nav.id ? <FichaCliente id={nav.id} nav={nav} ir={ir} /> : <Clientes nav={nav} ir={ir} />)}
      {aba === "novo" && <NovoPedido clienteInicial={nav.id} ir={ir} />}
      {aba === "pedidos" && (<><Topo titulo="Pedidos" ajuda="pedidos"><button type="button" className="btn-app-principal hidden sm:inline-flex" onClick={() => ir({ aba: "novo" })}>Nova venda</button></Topo><div className="max-w-3xl"><Pedidos /></div></>)}
      {aba === "maleta" && (<><Topo titulo="Minha maleta" ajuda="maleta" />{seletorMaleta}<div className="max-w-3xl"><MinhaMaleta cycleId={atual} /></div></>)}
      {aba === "historico" && (<><Topo titulo="Entregas da maleta" ajuda="maleta" voltar={() => ir({ aba: "mais" })} />{seletorMaleta}<div className="max-w-3xl"><Historico cycleId={atual} /></div></>)}
      {aba === "vitrine" && (<><Topo titulo="Minha vitrine" ajuda="vitrine" voltar={() => ir({ aba: "mais" })} /><Estudio /></>)}
      {aba === "mais" && <Mais ir={ir} />}
    </CascaConsultora>
  );
}

const PASSOS = [
  { t: "Bem-vinda à sua área", d: "Aqui você cuida das suas clientes, dos seus pedidos, da sua maleta e da sua vitrine, tudo pelo celular." },
  { t: "Menu embaixo da tela", d: "Início, Clientes, Pedidos, Maleta e Mais. Em “Mais” ficam a sua vitrine e as entregas." },
  { t: "Nova venda", d: "No Início, toque em “Nova venda”: escolha a cliente, as peças e confira antes de confirmar." },
  { t: "Dúvidas?", d: "Toque em “Ajuda” no alto da tela. Ao fechar, você volta para onde estava. Este passeio pode ser revisto na Central de Ajuda." },
];

/** Passeio curto e opcional: abre sozinho só na primeira visita. */
function Passeio() {
  const [aberto, setAberto] = React.useState(false);
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    try { if (!localStorage.getItem("lardan-passeio-consultora-v2")) setAberto(true); } catch { /* sem armazenamento */ }
    const reabrir = () => { setI(0); setAberto(true); };
    window.addEventListener("lardan:passeio", reabrir);
    return () => window.removeEventListener("lardan:passeio", reabrir);
  }, []);
  const fechar = () => {
    setAberto(false); setI(0);
    try { localStorage.setItem("lardan-passeio-consultora-v2", "1"); } catch { /* ok */ }
  };
  const p = PASSOS[i]!;
  return (
    <Dialog open={aberto} onOpenChange={(o) => (o ? setAberto(true) : fechar())}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-left">
          <p className="text-base text-muted-foreground">Passo {i + 1} de {PASSOS.length}</p>
          <DialogTitle className="font-display text-3xl">{p.t}</DialogTitle>
          <DialogDescription className="text-[1.08rem] leading-relaxed text-foreground">{p.d}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex gap-2">
          {i > 0 && <button type="button" className="admin-btn min-h-13 flex-1 justify-center text-base" onClick={() => setI(i - 1)}>Voltar</button>}
          <button type="button" className="btn-app-principal flex-1" onClick={() => (i < PASSOS.length - 1 ? setI(i + 1) : fechar())}>
            {i < PASSOS.length - 1 ? "Próximo" : "Começar"}
          </button>
        </div>
        <button type="button" className="min-h-12 text-base underline" onClick={fechar}>Pular passeio</button>
      </DialogContent>
    </Dialog>
  );
}

import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, ExternalLink, PackageCheck, ShoppingBag, Store } from "lucide-react";
import { toast } from "sonner";
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
  minhaVitrine,
  mudarSituacaoPedido,
  publicarPeca,
  salvarVitrine,
  traduzir,
  type TipoDivergencia,
} from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/consultora")({
  component: AreaConsultora,
  head: () => ({
    meta: [
      { title: "Minha área — Consultora LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
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
                      <p className="truncate text-sm font-semibold">{c.produto}</p>
                      <p className="text-xs text-ledger-muted">
                        {c.variante ?? "—"} · enviadas {c.quantidade} · aceitas {c.quantidade - div}
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={c.quantidade}
                      aria-label={`Unidades com problema de ${c.produto}`}
                      className="admin-input w-20"
                      value={divergencias[c.variant_id] ?? 0}
                      onChange={(e) =>
                        setDivergencias((v) => ({
                          ...v,
                          [c.variant_id]: Math.min(Math.max(0, Number(e.target.value)), c.quantidade),
                        }))
                      }
                    />
                  </div>
                  {div > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        aria-label={`Tipo da divergência de ${c.produto}`}
                        className="admin-input"
                        value={tipos[c.variant_id] ?? "faltante"}
                        onChange={(e) =>
                          setTipos((v) => ({ ...v, [c.variant_id]: e.target.value as TipoDivergencia }))
                        }
                      >
                        <option value="faltante">Não veio na maleta</option>
                        <option value="defeito">Veio com defeito</option>
                      </select>
                      <input
                        className="admin-input"
                        aria-label={`Motivo da divergência de ${c.produto}`}
                        placeholder="Descreva o que aconteceu"
                        value={motivos[c.variant_id] ?? ""}
                        onChange={(e) => setMotivos((v) => ({ ...v, [c.variant_id]: e.target.value }))}
                      />
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
    </div>
  );
}

/* ---------------- vitrine ---------------- */
function MinhaVitrine() {
  const qc = useQueryClient();
  const atual = useQuery({ queryKey: ["consultora", "vitrine"], queryFn: minhaVitrine });
  const [form, setForm] = React.useState({ slug: "", headline: "", bio: "", whatsapp: "", is_public: false });
  const [carregou, setCarregou] = React.useState(false);

  React.useEffect(() => {
    if (atual.data && !carregou) {
      setForm({
        slug: atual.data.slug ?? "",
        headline: atual.data.headline ?? "",
        bio: atual.data.bio ?? "",
        whatsapp: atual.data.whatsapp ?? "",
        is_public: atual.data.is_public ?? false,
      });
      setCarregou(true);
    }
  }, [atual.data, carregou]);

  const salvar = useMutation({
    mutationFn: () => salvarVitrine(form),
    onSuccess: () => {
      toast.success("Vitrine salva.");
      void qc.invalidateQueries({ queryKey: ["consultora", "vitrine"] });
    },
    onError: (e) => toast.error(traduzir(e)),
  });

  const origem = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Cartao>
      <p className="font-semibold">Minha vitrine</p>
      <p className="mt-1 text-sm text-ledger-muted">
        Suas peças aceitas e disponíveis aparecem sozinhas. Nada de custo, documento ou endereço é publicado.
      </p>
      <div className="mt-4 space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-ledger-muted">Endereço</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ledger-muted">{origem}/</span>
            <input
              className="admin-input flex-1"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
              placeholder="seunome"
            />
          </div>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-ledger-muted">Frase de apresentação</span>
          <input
            className="admin-input"
            value={form.headline}
            onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-ledger-muted">Sobre você</span>
          <textarea
            className="admin-input min-h-24"
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-ledger-muted">WhatsApp</span>
          <input
            className="admin-input"
            value={form.whatsapp}
            onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.value }))}
            placeholder="43999999999"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_public}
            onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
          />
          Deixar minha vitrine no ar
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </button>
        {atual.data?.slug && atual.data.is_public && (
          <a className="admin-btn" href={`/${atual.data.slug}`} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden className="size-4" /> Ver minha vitrine
          </a>
        )}
      </div>
    </Cartao>
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
  const [aba, setAba] = React.useState<Aba>("maleta");
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const maletas = useQuery({ queryKey: ["consultora", "maletas"], queryFn: () => listarMaletas() });

  // Só maletas que o próprio banco devolveu para esta pessoa entram na escolha.
  const abertas = (maletas.data ?? []).filter((m) => !["encerrada", "cancelada"].includes(m.situacao));
  const valida = escolhida && abertas.some((m) => m.cycle_id === escolhida) ? escolhida : null;
  const atual = valida ?? abertas[0]?.cycle_id ?? null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6">
      <header>
        <p className="text-xs uppercase tracking-[0.25em] text-ledger-muted">Lardan</p>
        <h1 className="font-display text-3xl">Minha área</h1>
      </header>

      <nav className="grid grid-cols-4 gap-2">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[0.7rem] ${
              aba === a.id ? "border-bronze text-ledger-text" : "border-line-soft text-ledger-muted"
            }`}
          >
            <a.icone aria-hidden className="size-5" />
            {a.rotulo}
          </button>
        ))}
      </nav>

      {abertas.length > 1 && (
        <label className="grid gap-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-ledger-muted">Maleta em uso</span>
          <select
            className="admin-input"
            value={atual ?? ""}
            onChange={(e) => setEscolhida(e.target.value || null)}
          >
            {abertas.map((m) => (
              <option key={m.cycle_id} value={m.cycle_id}>
                {m.codigo} · ciclo {m.ciclo} · {SITUACAO_MALETA[m.situacao]?.rotulo ?? m.situacao}
              </option>
            ))}
          </select>
        </label>
      )}

      {aba === "maleta" && <MinhaMaleta cycleId={atual} />}
      {aba === "vitrine" && <MinhaVitrine />}
      {aba === "pedidos" && <Pedidos />}
      {aba === "historico" && <Historico cycleId={atual} />}
    </div>
  );
}

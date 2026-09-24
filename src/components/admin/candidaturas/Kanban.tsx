import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, MessageCircle, UserRound, Clock3, ArrowRightLeft } from "lucide-react";
import {
  desde,
  iniciais,
  linkWhatsapp,
  mensagemPadrao,
  moverEtapa,
  prazo,
  registrarCliqueWhatsapp,
  rotuloOrigem,
  type Board,
  type CandidaturaCard,
  type Etapa,
  type Opcoes,
} from "@/lib/crm/api";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- selos -- */

function Selo({
  tom,
  children,
}: {
  tom: "novo" | "hoje" | "atrasado" | "aviso" | "prioridade" | "neutro";
  children: React.ReactNode;
}) {
  const mapa = {
    novo: "border-info/40 bg-info/10 text-info",
    hoje: "border-success/40 bg-success/10 text-success",
    atrasado: "border-danger/40 bg-danger/10 text-danger",
    aviso: "border-warning/40 bg-warning/10 text-warning",
    prioridade: "border-bronze/40 bg-champagne-soft text-bronze",
    neutro: "border-line bg-surface-muted text-ledger-muted",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.06em] uppercase",
        mapa[tom],
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- card -- */

export function CardCandidatura({
  c,
  etapas,
  onFollowup,
  onMover,
  arrastavel = true,
}: {
  c: CandidaturaCard;
  etapas: Etapa[];
  onFollowup: (c: CandidaturaCard) => void;
  onMover: (c: CandidaturaCard, etapa: string) => void;
  arrastavel?: boolean;
}) {
  const [movendo, setMovendo] = useState(false);
  const p = prazo(c.proximo_followup);
  const novo = !c.primeiro_atendimento && c.desfecho === "aberta";
  const reenviadoAgora = c.reenvios > 1 && Date.now() - new Date(c.ultimo_envio).getTime() < 86_400_000;

  function abrirWhatsapp() {
    void registrarCliqueWhatsapp(c.id).catch(() => undefined);
    window.open(
      linkWhatsapp(c.whatsapp_norm, mensagemPadrao(c.nome, c.responsavel)),
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <article
      draggable={arrastavel}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group rounded-xl border border-line-soft bg-surface p-3 shadow-sm transition hover:border-bronze/50 hover:shadow-md"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-champagne-soft text-[0.6875rem] font-semibold text-bronze"
        >
          {iniciais(c.nome)}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            to="/admin/candidaturas/$id"
            params={{ id: c.id }}
            className="block truncate text-[0.9375rem] font-semibold text-ledger-text hover:text-bronze"
          >
            {c.nome}
          </Link>
          <p className="truncate text-xs text-ledger-muted">
            {c.cidade}/{c.uf} · {rotuloOrigem(c.origem)}
          </p>
        </div>
      </div>

      {c.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {c.tags.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="rounded-md px-1.5 py-0.5 text-[0.625rem] font-semibold"
              style={{ backgroundColor: `${t.cor}1a`, color: t.cor }}
            >
              {t.nome}
            </span>
          ))}
          {c.tags.length > 3 && (
            <span className="text-[0.625rem] text-ledger-muted">+{c.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1">
        {novo && <Selo tom="novo">Novo</Selo>}
        {reenviadoAgora && <Selo tom="hoje">Reenviado agora</Selo>}
        {p.tom === "atrasado" && <Selo tom="atrasado">Atrasado</Selo>}
        {p.tom === "hoje" && <Selo tom="hoje">Hoje</Selo>}
        {p.tom === "nenhum" && c.desfecho === "aberta" && <Selo tom="aviso">Sem próxima ação</Selo>}
        {!c.responsavel_id && <Selo tom="aviso">Sem responsável</Selo>}
        {c.prioridade !== "normal" && (
          <Selo tom="prioridade">{c.prioridade === "urgente" ? "Urgente" : "Alta"}</Selo>
        )}
        {c.reenvios > 1 && <Selo tom="neutro">{c.reenvios} envios · último {desde(c.ultimo_envio)}</Selo>}
      </div>

      <dl className="mt-2.5 space-y-0.5 text-[0.6875rem] text-ledger-muted">
        <div className="flex items-center gap-1.5">
          <UserRound aria-hidden className="size-3" />
          <dt className="sr-only">Responsável</dt>
          <dd>{c.responsavel ?? "Sem responsável"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock3 aria-hidden className="size-3" />
          <dt className="sr-only">Último contato</dt>
          <dd>
            Último contato: {c.ultimo_contato ? desde(c.ultimo_contato) : "nenhum"} · nesta etapa{" "}
            {desde(c.etapa_desde).replace("há ", "")}
          </dd>
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5",
            p.tom === "atrasado" && "font-semibold text-danger",
            p.tom === "hoje" && "font-semibold text-success",
          )}
        >
          <CalendarPlus aria-hidden className="size-3" />
          <dt className="sr-only">Próximo follow-up</dt>
          <dd>{p.texto}</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={abrirWhatsapp}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[0.6875rem] font-semibold text-ledger-text transition hover:border-success hover:text-success"
        >
          <MessageCircle aria-hidden className="size-3.5" />
          WhatsApp
        </button>
        <button
          type="button"
          onClick={() => onFollowup(c)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[0.6875rem] font-semibold text-ledger-text transition hover:border-bronze hover:text-bronze"
        >
          <CalendarPlus aria-hidden className="size-3.5" />
          Follow-up
        </button>
        <button
          type="button"
          onClick={() => setMovendo((v) => !v)}
          aria-label="Mover de etapa"
          title="Mover de etapa"
          className="ml-auto rounded-lg border border-line p-1 text-ledger-muted transition hover:border-bronze hover:text-bronze"
        >
          <ArrowRightLeft aria-hidden className="size-3.5" />
        </button>
      </div>

      {/* Alternativa acessível ao arrasto: funciona no toque e no teclado. */}
      {movendo && (
        <div className="mt-2">
          <SmartSelect
            value={c.etapa_id}
            onChange={(v) => {
              setMovendo(false);
              if (v !== c.etapa_id) onMover(c, v);
            }}
            options={etapas.map((e) => ({ value: e.id, label: e.nome }))}
          />
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------ quadro -- */

export function Kanban({
  board,
  opcoes,
  onFollowup,
}: {
  board: Board;
  opcoes: Opcoes | undefined;
  onFollowup: (c: CandidaturaCard) => void;
}) {
  const qc = useQueryClient();
  const [sobre, setSobre] = useState<string | null>(null);
  /** Movimento otimista: se o banco recusar, o card volta sozinho. */
  const [otimista, setOtimista] = useState<Record<string, string>>({});

  const mover = useMutation({
    mutationFn: ({ lead, etapa }: { lead: string; etapa: string }) => moverEtapa(lead, etapa),
    onSuccess: async (_d, v) => {
      await qc.invalidateQueries({ queryKey: ["crm"] });
      setOtimista((o) => {
        const { [v.lead]: _ignorado, ...resto } = o;
        return resto;
      });
      toast.success("Etapa atualizada.");
    },
    onError: (e: Error, v) => {
      setOtimista((o) => {
        const { [v.lead]: _ignorado, ...resto } = o;
        return resto;
      });
      toast.error(e.message);
    },
  });

  function aplicar(c: CandidaturaCard, etapa: string) {
    if (etapa === (otimista[c.id] ?? c.etapa_id)) return;
    setOtimista((o) => ({ ...o, [c.id]: etapa }));
    mover.mutate({ lead: c.id, etapa });
  }

  const etapaDe = (c: CandidaturaCard) => otimista[c.id] ?? c.etapa_id;

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
      {board.etapas.map((etapa) => {
        const cards = board.cards.filter((c) => etapaDe(c) === etapa.id);
        return (
          <section
            key={etapa.id}
            onDragOver={(e) => {
              e.preventDefault();
              setSobre(etapa.id);
            }}
            onDragLeave={() => setSobre((s) => (s === etapa.id ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              const id = e.dataTransfer.getData("text/plain");
              const card = board.cards.find((c) => c.id === id);
              if (card) aplicar(card, etapa.id);
            }}
            className={cn(
              "flex w-[290px] shrink-0 flex-col rounded-2xl border bg-warm-ivory/60 p-2.5 transition",
              sobre === etapa.id ? "border-bronze bg-champagne-soft/50" : "border-line-soft",
            )}
          >
            <header className="mb-2.5 flex items-center gap-2 px-1">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: etapa.cor }}
              />
              <h3 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-ledger-text">
                {etapa.nome}
              </h3>
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ledger-muted num">
                {cards.length}
              </span>
            </header>

            <div className="flex min-h-[80px] flex-col gap-2">
              {cards.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-ledger-muted">
                  Nenhuma candidatura nesta etapa.
                </p>
              ) : (
                cards.map((c) => (
                  <CardCandidatura
                    key={c.id}
                    c={c}
                    etapas={board.etapas}
                    onFollowup={onFollowup}
                    onMover={aplicar}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
      {opcoes && board.etapas.length === 0 && (
        <p className="text-sm text-ledger-muted">Nenhuma etapa ativa configurada.</p>
      )}
    </div>
  );
}

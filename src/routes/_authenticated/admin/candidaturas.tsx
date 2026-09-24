import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlarmClock,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Columns3,
  Inbox,
  List,
  MessageCircle,
  Sparkles,
  UserRoundX,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorState, PageHeader, Panel, Skeleton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { Kanban, CardCandidatura } from "@/components/admin/candidaturas/Kanban";
import { AvisosPush } from "@/components/admin/candidaturas/AvisosPush";
import { FollowupDialog } from "@/components/admin/candidaturas/FollowupDialog";
import {
  carregarAgenda,
  carregarBoard,
  carregarLista,
  carregarMetricas,
  carregarOpcoes,
  concluirFollowup,
  dataHora,
  desde,
  linkWhatsapp,
  prazo,
  registrarCliqueWhatsapp,
  rotuloOrigem,
  rotuloTipoFollowup,
  type CandidaturaCard,
  type Filtros,
} from "@/lib/crm/api";
import { cn } from "@/lib/utils";

/** Filtros vivem na URL: voltar do cockpit devolve o quadro exatamente como estava. */
type Busca = {
  vista?: "kanban" | "lista" | "followups";
  q?: string;
  etapa?: string;
  desfecho?: string;
  prioridade?: string;
  responsavel?: string;
  origem?: string;
  campanha?: string;
  uf?: string;
  tag?: string;
  de?: string;
  ate?: string;
  followup?: string;
  arquivadas?: boolean;
};

/** Remove chaves vazias para não sujar a URL nem o tipo de busca da rota. */
function enxugar(b: Record<string, unknown>): Busca {
  return Object.fromEntries(
    Object.entries(b).filter(([, v]) => v !== undefined && v !== "" && v !== false),
  ) as Busca;
}

export const Route = createFileRoute("/_authenticated/admin/candidaturas")({
  component: CandidaturasPage,
  validateSearch: (s: Record<string, unknown>): Busca =>
    enxugar({
      vista: (s["vista"] as Busca["vista"]) ?? "kanban",
      q: s["q"],
      etapa: s["etapa"],
      desfecho: s["desfecho"],
      prioridade: s["prioridade"],
      responsavel: s["responsavel"],
      origem: s["origem"],
      campanha: s["campanha"],
      uf: s["uf"],
      tag: s["tag"],
      de: s["de"],
      ate: s["ate"],
      followup: s["followup"],
      arquivadas: s["arquivadas"] === true || s["arquivadas"] === "true",
    }),
  head: () => ({
    meta: [
      { title: "Candidaturas do Site — Lardan Cloud" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

/* ------------------------------------------------------------- radar -- */

function CardRadar({
  icone: Icone,
  numero,
  titulo,
  legenda,
  tom,
  ativo,
  onClick,
}: {
  icone: typeof Inbox;
  numero: number;
  titulo: string;
  legenda: string;
  tom: "danger" | "success" | "info" | "warning" | "neutro";
  ativo: boolean;
  onClick: () => void;
}) {
  const mapa = {
    danger: "text-danger",
    success: "text-success",
    info: "text-info",
    warning: "text-warning",
    neutro: "text-ledger-muted",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3 rounded-xl border bg-surface px-4 py-3 text-left transition",
        ativo ? "border-bronze shadow-md" : "border-line-soft hover:border-bronze/50",
      )}
    >
      <Icone aria-hidden className={cn("size-5 shrink-0", mapa[tom])} />
      <span className="min-w-0">
        <span className={cn("block text-2xl leading-none font-semibold num", mapa[tom])}>
          {numero}
        </span>
        <span className="mt-1 block truncate text-[0.8125rem] font-semibold text-ledger-text">
          {titulo}
        </span>
        <span className="block truncate text-[0.6875rem] text-ledger-muted">{legenda}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- tela -- */

function CandidaturasPage() {
  const caps = useCapabilities();
  const podeVer = caps.includes("candidaturas.view" as never);
  const busca = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();

  const [textoBusca, setTextoBusca] = useState(busca.q ?? "");
  const [followupDe, setFollowupDe] = useState<CandidaturaCard | null>(null);
  const [abaAgenda, setAbaAgenda] = useState("atrasados");

  // Busca com espera: não dispara consulta a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((busca.q ?? "") !== textoBusca) {
        void navigate({ search: (s) => enxugar({ ...s, q: textoBusca }), replace: true });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [textoBusca, busca.q, navigate]);

  const filtros: Filtros = useMemo(() => {
    const { vista: _v, ...resto } = busca;
    return resto;
  }, [busca]);

  const opcoes = useQuery({
    queryKey: ["crm", "opcoes"],
    queryFn: carregarOpcoes,
    enabled: podeVer,
    staleTime: 60_000,
  });
  const board = useQuery({
    queryKey: ["crm", "board", filtros],
    queryFn: () => carregarBoard(filtros),
    enabled: podeVer && busca.vista !== "lista" && busca.vista !== "followups",
  });
  const lista = useQuery({
    queryKey: ["crm", "lista", filtros],
    queryFn: () => carregarLista(filtros, 100, 0),
    enabled: podeVer && busca.vista === "lista",
  });
  const radar = useQuery({
    queryKey: ["crm", "radar"],
    queryFn: () => carregarBoard({}).then((b) => b.radar),
    enabled: podeVer,
  });
  const metricas = useQuery({
    queryKey: ["crm", "metricas"],
    queryFn: () => carregarMetricas(),
    enabled: podeVer,
  });
  const agenda = useQuery({
    queryKey: ["crm", "agenda", abaAgenda],
    queryFn: () => carregarAgenda(abaAgenda),
    enabled: podeVer && busca.vista === "followups",
  });

  // Chegou uma candidatura nova ou um reenvio: o quadro se atualiza sozinho.
  useEffect(() => {
    if (!podeVer) return;
    const canal = supabase
      .channel("crm-candidaturas")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, () => {
        void qc.invalidateQueries({ queryKey: ["crm"] });
        toast.info("Nova candidatura recebida pelo site.");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads" }, () => {
        void qc.invalidateQueries({ queryKey: ["crm"] });
        toast.info("Candidatura reenviada pelo site.");
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [podeVer, qc]);

  const concluir = useMutation({
    mutationFn: (id: string) => concluirFollowup(id),
    onSuccess: async () => {
      toast.success("Follow-up concluído.");
      await qc.invalidateQueries({ queryKey: ["crm"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const r = radar.data;
  const filtrosAtivos = Object.entries(filtros).filter(([, v]) => v !== undefined && v !== "");

  const setFiltro = (chave: keyof Filtros, valor: string | undefined) =>
    void navigate({ search: (s) => enxugar({ ...s, [chave]: valor }), replace: true });
  const setVista = (v: Busca["vista"]) => void navigate({ search: (s) => enxugar({ ...s, vista: v }) });

  if (!podeVer) {
    return (
      <div className="max-w-xl">
        <PageHeader eyebrow="Comercial" title="Candidaturas do Site" />
        <p className="mt-6 text-sm text-ledger-muted">
          Você não tem permissão para este módulo. Fale com a Diretoria.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Comercial"
        title="Candidaturas do Site"
        description="Todas as pessoas que se candidataram a Consultora Lardan pelo formulário Seja Lardan, com etapa, responsável, origem e próxima ação."
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <AvisosPush />
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
            {(
              [
                ["kanban", "Kanban", Columns3],
                ["lista", "Lista", List],
                ["followups", "Follow-ups", CalendarClock],
              ] as const
            ).map(([v, rotulo, Icone]) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold transition",
                  busca.vista === v
                    ? "bg-champagne-soft text-bronze"
                    : "text-ledger-muted hover:text-ledger-text",
                )}
              >
                <Icone aria-hidden className="size-4" />
                {rotulo}
              </button>
            ))}
          </div>
          </div>
        }
      />

      {/* RADAR OPERACIONAL — cada card aplica o filtro correspondente */}
      <div className="mt-6 flex flex-wrap gap-3">
        {radar.isLoading || !r ? (
          <>
            <Skeleton className="h-[78px] flex-1" />
            <Skeleton className="h-[78px] flex-1" />
            <Skeleton className="h-[78px] flex-1" />
            <Skeleton className="h-[78px] flex-1" />
          </>
        ) : (
          <>
            <CardRadar
              icone={AlarmClock}
              numero={r.atrasados}
              titulo="Atrasados"
              legenda="Precisam de atenção"
              tom="danger"
              ativo={busca.followup === "atrasado"}
              onClick={() =>
                setFiltro("followup", busca.followup === "atrasado" ? undefined : "atrasado")
              }
            />
            <CardRadar
              icone={CalendarCheck}
              numero={r.hoje}
              titulo="Para hoje"
              legenda="Follow-ups programados"
              tom="success"
              ativo={busca.followup === "hoje"}
              onClick={() => setFiltro("followup", busca.followup === "hoje" ? undefined : "hoje")}
            />
            <CardRadar
              icone={CalendarClock}
              numero={r.proximas}
              titulo="Próximas horas"
              legenda="Nas próximas 4 horas"
              tom="info"
              ativo={busca.followup === "proximas"}
              onClick={() =>
                setFiltro("followup", busca.followup === "proximas" ? undefined : "proximas")
              }
            />
            <CardRadar
              icone={UserRoundX}
              numero={r.sem_acao}
              titulo="Sem próxima ação"
              legenda="Nenhum retorno agendado"
              tom="warning"
              ativo={busca.followup === "sem"}
              onClick={() => setFiltro("followup", busca.followup === "sem" ? undefined : "sem")}
            />
            <CardRadar
              icone={Sparkles}
              numero={r.novas}
              titulo="Novas candidaturas"
              legenda="Ainda sem primeiro atendimento"
              tom="info"
              ativo={busca.followup === "novas"}
              onClick={() => setFiltro("followup", busca.followup === "novas" ? undefined : "novas")}
            />
          </>
        )}
      </div>

      {/* FILTROS */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={textoBusca}
          onChange={(e) => setTextoBusca(e.target.value)}
          placeholder="Buscar por nome, WhatsApp, e-mail, cidade ou protocolo"
          aria-label="Buscar candidatura"
          className="h-10 min-w-[280px] flex-1 rounded-lg border border-line bg-surface px-3.5 text-sm text-ledger-text"
        />
        <SmartSelect
          className="w-44"
          value={busca.etapa ?? ""}
          onChange={(v) => setFiltro("etapa", v)}
          placeholder="Etapa"
          options={(opcoes.data?.etapas ?? []).map((e) => ({ value: e.id, label: e.nome }))}
        />
        <SmartSelect
          className="w-40"
          value={busca.responsavel ?? ""}
          onChange={(v) => setFiltro("responsavel", v)}
          placeholder="Responsável"
          options={[
            { value: "meu", label: "Minhas candidaturas" },
            { value: "sem", label: "Sem responsável" },
            ...(opcoes.data?.usuarios ?? []).map((u) => ({ value: u.id, label: u.nome })),
          ]}
        />
        <SmartSelect
          className="w-40"
          value={busca.origem ?? ""}
          onChange={(v) => setFiltro("origem", v)}
          placeholder="Origem"
          options={(opcoes.data?.origens ?? []).map((o) => ({ value: o, label: rotuloOrigem(o) }))}
        />
        <SmartSelect
          className="w-40"
          value={busca.tag ?? ""}
          onChange={(v) => setFiltro("tag", v)}
          placeholder="Etiqueta"
          options={(opcoes.data?.etiquetas ?? []).map((t) => ({ value: t.id, label: t.nome }))}
        />
        <SmartSelect
          className="w-36"
          value={busca.desfecho ?? ""}
          onChange={(v) => setFiltro("desfecho", v)}
          placeholder="Situação"
          options={[
            { value: "aberta", label: "Em aberto" },
            { value: "ganha", label: "Aprovadas" },
            { value: "perdida", label: "Perdidas" },
          ]}
        />
        {filtrosAtivos.length > 0 && (
          <button
            type="button"
            onClick={() => void navigate({ search: enxugar({ vista: busca.vista }) })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[0.8125rem] font-semibold text-ledger-muted hover:border-danger hover:text-danger"
          >
            <X aria-hidden className="size-3.5" />
            Limpar filtros ({filtrosAtivos.length})
          </button>
        )}
      </div>

      {/* CONTEÚDO */}
      <div className="mt-5">
        {busca.vista === "followups" ? (
          <Panel title="Central de follow-ups" flush>
            <div className="flex gap-1 border-b border-line-soft px-5 py-3">
              {(
                [
                  ["atrasados", "Atrasados"],
                  ["hoje", "Hoje"],
                  ["amanha", "Amanhã"],
                  ["semana", "Próximos 7 dias"],
                  ["concluidos", "Concluídos"],
                ] as const
              ).map(([v, rotulo]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAbaAgenda(v)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold transition",
                    abaAgenda === v
                      ? "bg-champagne-soft text-bronze"
                      : "text-ledger-muted hover:text-ledger-text",
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <div className="divide-y divide-line-soft">
              {agenda.isLoading ? (
                <div className="px-5 py-6">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (agenda.data?.length ?? 0) === 0 ? (
                <div className="px-5">
                  <EmptyState
                    title="Nenhum follow-up nesta faixa."
                    description="Agende retornos pelo quadro ou pela ficha da candidata para que eles apareçam aqui."
                  />
                </div>
              ) : (
                agenda.data!.map((f) => {
                  const p = prazo(f.quando);
                  return (
                    <div key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <span
                        className={cn(
                          "w-40 shrink-0 text-[0.8125rem] font-semibold",
                          p.tom === "atrasado" && "text-danger",
                          p.tom === "hoje" && "text-success",
                        )}
                      >
                        {dataHora(f.quando)}
                      </span>
                      <Link
                        to="/admin/candidaturas/$id"
                        params={{ id: f.candidatura_id }}
                        className="min-w-[160px] flex-1 text-sm font-semibold text-ledger-text hover:text-bronze"
                      >
                        {f.candidata}
                      </Link>
                      <span className="text-xs text-ledger-muted">
                        {f.cidade}/{f.uf}
                      </span>
                      <span className="text-xs text-ledger-muted">
                        {rotuloTipoFollowup(f.tipo)}
                      </span>
                      <span className="text-xs text-ledger-muted">{f.etapa}</span>
                      <span className="text-xs text-ledger-muted">
                        {f.responsavel ?? "Sem responsável"}
                      </span>
                      <a
                        href={linkWhatsapp(f.whatsapp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => void registrarCliqueWhatsapp(f.candidatura_id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[0.6875rem] font-semibold hover:border-success hover:text-success"
                      >
                        <MessageCircle aria-hidden className="size-3.5" />
                        WhatsApp
                      </a>
                      {f.situacao === "pendente" && (
                        <button
                          type="button"
                          onClick={() => concluir.mutate(f.id)}
                          disabled={concluir.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[0.6875rem] font-semibold hover:border-bronze hover:text-bronze"
                        >
                          <CheckCircle2 aria-hidden className="size-3.5" />
                          Concluir
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Panel>
        ) : busca.vista === "lista" ? (
          <Panel
            title={`Lista${lista.data ? ` · ${lista.data.total} candidatura(s)` : ""}`}
            flush
          >
            {lista.isLoading ? (
              <div className="px-5 py-6">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : lista.error ? (
              <div className="px-5 py-4">
                <ErrorState message={(lista.error as Error).message} />
              </div>
            ) : (lista.data?.itens.length ?? 0) === 0 ? (
              <div className="px-5">
                <EmptyState
                  title="Nenhuma candidatura encontrada."
                  description="Novas candidaturas enviadas pelo formulário Seja Lardan aparecem aqui automaticamente."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {[
                        "Nome",
                        "Cidade",
                        "WhatsApp",
                        "Origem",
                        "Etapa",
                        "Responsável",
                        "Último envio",
                        "Último contato",
                        "Próximo follow-up",
                        "Situação",
                      ].map((h) => (
                        <th key={h} className="ledger-eyebrow px-4 py-3 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {lista.data!.itens.map((c) => {
                      const etapa = opcoes.data?.etapas.find((e) => e.id === c.etapa_id);
                      const p = prazo(c.proximo_followup);
                      return (
                        <tr key={c.id} className="hover:bg-warm-ivory/60">
                          <td className="px-4 py-3">
                            <Link
                              to="/admin/candidaturas/$id"
                              params={{ id: c.id }}
                              className="font-semibold text-ledger-text hover:text-bronze"
                            >
                              {c.nome}
                            </Link>
                            <span className="block text-[0.6875rem] text-ledger-muted num">
                              {c.protocolo}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-ledger-muted">
                            {c.cidade}/{c.uf}
                          </td>
                          <td className="px-4 py-3 text-xs num">{c.whatsapp}</td>
                          <td className="px-4 py-3 text-xs">{rotuloOrigem(c.origem)}</td>
                          <td className="px-4 py-3 text-xs">{etapa?.nome ?? "—"}</td>
                          <td className="px-4 py-3 text-xs text-ledger-muted">
                            {c.responsavel ?? "Sem responsável"}
                          </td>
                          <td className="px-4 py-3 text-xs text-ledger-muted">
                            {dataHora(c.ultimo_envio)}
                          </td>
                          <td className="px-4 py-3 text-xs text-ledger-muted">
                            {c.ultimo_contato ? desde(c.ultimo_contato) : "nenhum"}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-xs",
                              p.tom === "atrasado" && "font-semibold text-danger",
                              p.tom === "hoje" && "font-semibold text-success",
                            )}
                          >
                            {p.texto}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {c.desfecho === "ganha"
                              ? "Aprovada"
                              : c.desfecho === "perdida"
                                ? "Perdida"
                                : "Em aberto"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : board.isLoading ? (
          <Skeleton className="h-[420px] w-full" />
        ) : board.error ? (
          <ErrorState message={(board.error as Error).message} onRetry={() => void board.refetch()} />
        ) : (board.data?.cards.length ?? 0) === 0 ? (
          <Panel>
            <EmptyState
              title="Nenhuma candidatura encontrada."
              description="Novas candidaturas enviadas pelo formulário Seja Lardan aparecem aqui automaticamente, com etapa, origem e histórico."
            />
          </Panel>
        ) : (
          <Kanban board={board.data!} opcoes={opcoes.data} onFollowup={setFollowupDe} />
        )}
      </div>

      {/* INDICADORES — operação primeiro, números depois */}
      {metricas.data && (
        <Panel title="Indicadores dos últimos 30 dias" className="mt-6">
          <dl className="grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-7">
            {[
              ["Candidaturas", metricas.data.total],
              ["Novas", metricas.data.novas],
              ["Em atendimento", metricas.data.em_atendimento],
              ["Aprovadas", metricas.data.ganhas],
              ["Perdidas", metricas.data.perdidas],
              ["Taxa de aprovação", `${metricas.data.taxa_conversao}%`],
              ["1º atendimento", `${metricas.data.minutos_primeiro_atendimento} min`],
            ].map(([rotulo, valor]) => (
              <div key={String(rotulo)}>
                <dt className="ledger-eyebrow">{rotulo}</dt>
                <dd className="mt-1 text-2xl font-semibold text-ledger-text num">{valor}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}

      {followupDe && (
        <FollowupDialog
          leadId={followupDe.id}
          nome={followupDe.nome}
          opcoes={opcoes.data}
          aberto
          onFechar={() => setFollowupDe(null)}
        />
      )}
    </div>
  );
}

/** Reexportado para manter o card do quadro acessível a outras telas. */
export { CardCandidatura };

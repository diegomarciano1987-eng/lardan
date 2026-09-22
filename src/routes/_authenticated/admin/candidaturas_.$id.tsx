import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  RotateCcw,
  StickyNote,
  Tag,
  ThumbsDown,
  Trophy,
  XCircle,
} from "lucide-react";
import { EmptyState, ErrorState, Panel, Skeleton, BackButton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { useCapabilities } from "@/lib/capabilities";
import { FollowupDialog } from "@/components/admin/candidaturas/FollowupDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  adicionarNota,
  aplicarEtiqueta,
  arquivar,
  atribuir,
  cancelarFollowup,
  carregarDetalhe,
  carregarOpcoes,
  concluirFollowup,
  dataHora,
  definirPrioridade,
  desde,
  iniciais,
  linkWhatsapp,
  marcarGanho,
  marcarPerdido,
  mensagemPadrao,
  moverEtapa,
  prazo,
  reabrir,
  registrarCliqueWhatsapp,
  rotuloOrigem,
  rotuloTipoFollowup,
} from "@/lib/crm/api";
import { cn } from "@/lib/utils";
import { GUIAS_RESUMO } from "@/lib/editorial";

export const Route = createFileRoute("/_authenticated/admin/candidaturas_/$id")({
  component: CockpitCandidata,
  head: () => ({
    meta: [
      { title: "Ficha da candidata — Lardan Cloud" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="ledger-eyebrow">{rotulo}</dt>
      <dd className="mt-1 text-sm break-words text-ledger-text">{valor || "—"}</dd>
    </div>
  );
}

/**
 * Jornada editorial: só aparece quando existe evidência real gravada no
 * first_touch/last_touch. Nada é deduzido e nenhum campo vazio é exibido.
 */
function JornadaEditorialCampos({ origem }: { origem: { first_touch: unknown; last_touch: unknown } }) {
  const tituloDe = (path?: string) =>
    path ? (GUIAS_RESUMO.find((g) => g.path === path)?.rotulo ?? path) : undefined;
  const jornadaDe = (t: unknown) =>
    ((t as { tracking?: { jornada?: Record<string, string> } } | null)?.tracking?.jornada ?? {}) as
      Record<string, string>;
  const primeira = jornadaDe(origem.first_touch);
  const ultima = jornadaDe(origem.last_touch);
  const primeiroConteudo = tituloDe(primeira["first_content_path"] ?? ultima["first_content_path"]);
  const ultimoConteudo = tituloDe(ultima["last_content_path"] ?? primeira["last_content_path"]);
  const cta = ultima["cta_origin"] ?? primeira["cta_origin"];

  if (!primeiroConteudo && !ultimoConteudo && !cta) return null;

  return (
    <dl className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-3">
      {primeiroConteudo ? <Campo rotulo="Primeiro conteúdo lido" valor={primeiroConteudo} /> : null}
      {ultimoConteudo ? (
        <Campo rotulo="Último conteúdo antes da candidatura" valor={ultimoConteudo} />
      ) : null}
      {cta ? <Campo rotulo="CTA de origem" valor={<span className="num text-xs">{cta}</span>} /> : null}
    </dl>
  );
}

function CockpitCandidata() {
  const { id } = Route.useParams();
  const caps = useCapabilities();
  const pode = (c: string) => caps.includes(c as never);
  const qc = useQueryClient();

  const [novaNota, setNovaNota] = useState("");
  const [abrirFollowup, setAbrirFollowup] = useState(false);
  const [abrirPerda, setAbrirPerda] = useState(false);
  const [abrirGanho, setAbrirGanho] = useState(false);
  const [motivoPerda, setMotivoPerda] = useState("");
  const [obsPerda, setObsPerda] = useState("");
  const [obsGanho, setObsGanho] = useState("");

  const detalhe = useQuery({
    queryKey: ["crm", "detalhe", id],
    queryFn: () => carregarDetalhe(id),
    enabled: pode("candidaturas.view"),
  });
  const opcoes = useQuery({
    queryKey: ["crm", "opcoes"],
    queryFn: carregarOpcoes,
    enabled: pode("candidaturas.view"),
    staleTime: 60_000,
  });

  const recarregar = async () => {
    await qc.invalidateQueries({ queryKey: ["crm"] });
  };
  const acao = <T,>(fn: (v: T) => Promise<unknown>, sucesso: string) =>
    ({
      mutationFn: fn,
      onSuccess: async () => {
        toast.success(sucesso);
        await recarregar();
      },
      onError: (e: Error) => toast.error(e.message),
    }) as const;

  const mover = useMutation(acao((etapa: string) => moverEtapa(id, etapa), "Etapa atualizada."));
  const responsavel = useMutation(
    acao((u: string) => atribuir(id, u || null), "Responsável atualizado."),
  );
  const prioridade = useMutation(
    acao((p: string) => definirPrioridade(id, p as "normal"), "Prioridade atualizada."),
  );
  const nota = useMutation(acao((texto: string) => adicionarNota(id, texto), "Nota adicionada."));
  const etiqueta = useMutation(
    acao((v: { tag: string; aplicar: boolean }) => aplicarEtiqueta(id, v.tag, v.aplicar), "Etiquetas atualizadas."),
  );
  const concluir = useMutation(acao((f: string) => concluirFollowup(f), "Follow-up concluído."));
  const cancelar = useMutation(acao((f: string) => cancelarFollowup(f), "Follow-up cancelado."));
  const ganho = useMutation(acao((obs: string) => marcarGanho(id, obs || undefined), "Candidatura aprovada."));
  const perda = useMutation(
    acao((v: { motivo: string; obs: string }) => marcarPerdido(id, v.motivo, v.obs || undefined), "Candidatura marcada como perdida."),
  );
  const reabertura = useMutation(acao(() => reabrir(id), "Candidatura reaberta."));
  const arquivamento = useMutation(acao(() => arquivar(id), "Candidatura arquivada."));

  if (!pode("candidaturas.view")) {
    return (
      <div className="max-w-xl">
        <BackButton />
        <p className="mt-6 text-sm text-ledger-muted">
          Você não tem permissão para ver candidaturas.
        </p>
      </div>
    );
  }
  if (detalhe.isLoading) return <Skeleton className="h-[500px] w-full" />;
  if (detalhe.error)
    return <ErrorState message={(detalhe.error as Error).message} onRetry={() => void detalhe.refetch()} />;

  const d = detalhe.data!;
  const c = d.candidatura;
  const etapaAtual = opcoes.data?.etapas.find((e) => e.id === c.etapa_id);
  const p = prazo(c.proximo_followup);
  const tagsAplicadas = new Set(c.tags.map((t) => t.id));

  function whatsapp() {
    void registrarCliqueWhatsapp(id).then(recarregar).catch(() => undefined);
    window.open(
      linkWhatsapp(c.whatsapp_norm, mensagemPadrao(c.nome, c.responsavel)),
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="min-w-0">
      {/* CABEÇALHO */}
      <header className="flex flex-wrap items-start gap-4 border-b border-line pb-6">
        <BackButton className="mt-1" />
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-champagne-soft text-lg font-semibold text-bronze"
        >
          {iniciais(c.nome)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[2rem] leading-tight font-semibold text-ledger-text">{c.nome}</h1>
            {etapaAtual && (
              <span
                className="rounded-md px-2 py-1 text-[0.6875rem] font-semibold uppercase"
                style={{ backgroundColor: `${etapaAtual.cor}1a`, color: etapaAtual.cor }}
              >
                {etapaAtual.nome}
              </span>
            )}
            {c.desfecho === "ganha" && (
              <span className="rounded-md bg-success/10 px-2 py-1 text-[0.6875rem] font-semibold text-success uppercase">
                Aprovada
              </span>
            )}
            {c.desfecho === "perdida" && (
              <span className="rounded-md bg-danger/10 px-2 py-1 text-[0.6875rem] font-semibold text-danger uppercase">
                Perdida · {c.motivo_perda}
              </span>
            )}
            {c.prioridade !== "normal" && (
              <span className="rounded-md bg-champagne-soft px-2 py-1 text-[0.6875rem] font-semibold text-bronze uppercase">
                {c.prioridade}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ledger-muted">
            {c.cidade}/{c.uf} · Responsável: {c.responsavel ?? "sem responsável"} · Protocolo{" "}
            <span className="num">{c.protocolo}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {c.tags.map((t) => (
              <span
                key={t.id}
                className="rounded-md px-1.5 py-0.5 text-[0.6875rem] font-semibold"
                style={{ backgroundColor: `${t.cor}1a`, color: t.cor }}
              >
                {t.nome}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={whatsapp} className="admin-btn admin-btn-primary">
            <MessageCircle aria-hidden className="size-4" />
            WhatsApp
          </button>
          {pode("candidaturas.followups") && (
            <button type="button" className="admin-btn" onClick={() => setAbrirFollowup(true)}>
              <CalendarPlus aria-hidden className="size-4" />
              Follow-up
            </button>
          )}
          {pode("candidaturas.mark_won") && c.desfecho !== "ganha" && (
            <button type="button" className="admin-btn" onClick={() => setAbrirGanho(true)}>
              <Trophy aria-hidden className="size-4" />
              Marcar ganho
            </button>
          )}
          {pode("candidaturas.mark_lost") && c.desfecho !== "perdida" && (
            <button type="button" className="admin-btn" onClick={() => setAbrirPerda(true)}>
              <ThumbsDown aria-hidden className="size-4" />
              Marcar perdido
            </button>
          )}
          {pode("candidaturas.reopen") && c.desfecho !== "aberta" && (
            <button
              type="button"
              className="admin-btn"
              disabled={reabertura.isPending}
              onClick={() => reabertura.mutate(undefined as never)}
            >
              <RotateCcw aria-hidden className="size-4" />
              Reabrir
            </button>
          )}
          {pode("candidaturas.archive") && !c.arquivada_em && (
            <button
              type="button"
              className="admin-btn"
              disabled={arquivamento.isPending}
              onClick={() => arquivamento.mutate(undefined as never)}
            >
              <Archive aria-hidden className="size-4" />
              Arquivar
            </button>
          )}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* CORPO */}
        <div className="min-w-0">
          <Tabs defaultValue="resumo">
            <TabsList>
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="atividade">Atividade</TabsTrigger>
              <TabsTrigger value="followups">Follow-ups</TabsTrigger>
              <TabsTrigger value="avaliacoes">Avaliações</TabsTrigger>
              <TabsTrigger value="dados">Dados</TabsTrigger>
            </TabsList>

            {/* RESUMO 360º */}
            <TabsContent value="resumo" className="space-y-5">
              <Panel title="Resumo">
                <dl className="grid grid-cols-2 gap-5 md:grid-cols-3">
                  <Campo rotulo="Telefone" valor={<span className="num">{c.whatsapp}</span>} />
                  <Campo
                    rotulo={c.cpf_visivel ? "CPF" : "CPF (mascarado)"}
                    valor={c.cpf ? <span className="num">{c.cpf}</span> : "Não informado"}
                  />
                  <Campo rotulo="E-mail" valor={c.email} />
                  <Campo rotulo="Cidade / Estado" valor={`${c.cidade}/${c.uf}`} />
                  <Campo rotulo="Data da candidatura" valor={dataHora(c.criada_em)} />
                  <Campo rotulo="Responsável" valor={c.responsavel ?? "Sem responsável"} />
                  <Campo rotulo="Origem" valor={rotuloOrigem(c.origem)} />
                  <Campo rotulo="Campanha" valor={c.campanha} />
                  <Campo rotulo="Tempo no funil" valor={desde(c.criada_em).replace("há ", "")} />
                  <Campo rotulo="Tempo na etapa" valor={desde(c.etapa_desde).replace("há ", "")} />
                  <Campo
                    rotulo="Último contato"
                    valor={c.ultimo_contato ? desde(c.ultimo_contato) : "Nenhum contato registrado"}
                  />
                  <Campo rotulo="Próximo follow-up" valor={p.texto} />
                  <Campo rotulo="Protocolo" valor={<span className="num">{c.protocolo}</span>} />
                </dl>
              </Panel>

              <Panel title="Respostas do formulário Seja Lardan">
                <dl className="grid gap-5 md:grid-cols-2">
                  <Campo rotulo="Objetivo" valor={c.objetivo} />
                  <Campo rotulo="Disponibilidade" valor={c.disponibilidade} />
                  <Campo rotulo="Experiência com vendas" valor={c.experiencia} />
                  <Campo rotulo="Canais utilizados" valor={c.canais} />
                  <Campo
                    rotulo="Endereço informado"
                    valor={[c.rua, c.sem_numero ? "s/n" : c.numero, c.cep].filter(Boolean).join(", ")}
                  />
                  <Campo
                    rotulo="Consentimento de marketing"
                    valor={`${c.consentimento_marketing ? "Aceito" : "Não aceito"} · aviso ${c.versao_privacidade}`}
                  />
                  <div className="md:col-span-2">
                    <Campo rotulo="Conte sobre você" valor={c.motivacao} />
                  </div>
                </dl>
              </Panel>

              <Panel
                title="Notas internas"
                action={<span className="text-xs text-ledger-muted">{d.notas.length}</span>}
              >
                {pode("candidaturas.notes") && (
                  <div className="mb-4">
                    <label htmlFor="nova-nota" className="sr-only">
                      Nova nota
                    </label>
                    <textarea
                      id="nova-nota"
                      rows={3}
                      value={novaNota}
                      onChange={(e) => setNovaNota(e.target.value)}
                      placeholder="Registre o que foi conversado, sem inventar informação."
                      className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ledger-text"
                    />
                    <button
                      type="button"
                      className="admin-btn mt-2"
                      disabled={nota.isPending || novaNota.trim().length < 2}
                      onClick={() =>
                        nota.mutate(novaNota.trim(), { onSuccess: () => setNovaNota("") })
                      }
                    >
                      <StickyNote aria-hidden className="size-4" />
                      Adicionar nota
                    </button>
                  </div>
                )}
                {d.notas.length === 0 ? (
                  <EmptyState
                    title="Nenhuma nota ainda."
                    description="As notas ficam com autor, data e histórico de edição."
                  />
                ) : (
                  <ul className="space-y-3">
                    {d.notas.map((n) => (
                      <li key={n.id} className="rounded-lg border border-line-soft bg-surface p-3">
                        <p className="text-sm whitespace-pre-wrap text-ledger-text">{n.texto}</p>
                        <p className="mt-2 text-[0.6875rem] text-ledger-muted">
                          {n.autor ?? "Usuário"} · {dataHora(n.em)}
                          {n.edicoes > 0 && ` · editada ${n.edicoes}×`}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </TabsContent>

            {/* TIMELINE */}
            <TabsContent value="atividade">
              <Panel title="Linha do tempo">
                {d.timeline.length === 0 ? (
                  <EmptyState title="Sem atividade." description="Nada foi registrado ainda." />
                ) : (
                  <ol className="relative space-y-4 border-l border-line pl-5">
                    {d.timeline.map((e) => (
                      <li key={e.id} className="relative">
                        <span
                          aria-hidden
                          className="absolute top-1.5 -left-[1.4375rem] size-2 rounded-full bg-bronze"
                        />
                        <p className="text-sm font-semibold text-ledger-text">{e.titulo}</p>
                        {e.descricao && (
                          <p className="mt-0.5 text-xs whitespace-pre-wrap text-ledger-muted">
                            {e.descricao}
                          </p>
                        )}
                        <p className="mt-0.5 text-[0.6875rem] text-ledger-muted">
                          {dataHora(e.em)}
                          {e.autor ? ` · ${e.autor}` : " · sistema"}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </TabsContent>

            {/* FOLLOW-UPS */}
            <TabsContent value="followups">
              <Panel
                title="Follow-ups"
                action={
                  pode("candidaturas.followups") && (
                    <button type="button" className="admin-btn" onClick={() => setAbrirFollowup(true)}>
                      <CalendarPlus aria-hidden className="size-4" />
                      Novo
                    </button>
                  )
                }
              >
                {d.followups.length === 0 ? (
                  <EmptyState
                    title="Nenhum follow-up."
                    description="Agende o próximo contato para que esta candidata não fique parada."
                  />
                ) : (
                  <ul className="space-y-2">
                    {d.followups.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-line-soft bg-surface px-3 py-2.5"
                      >
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            f.atrasado && "text-danger",
                            f.situacao === "concluido" && "text-ledger-muted line-through",
                          )}
                        >
                          {dataHora(f.quando)}
                        </span>
                        <span className="text-xs text-ledger-muted">
                          {rotuloTipoFollowup(f.tipo)}
                        </span>
                        <span className="text-xs text-ledger-muted">
                          {f.responsavel ?? "Sem responsável"}
                        </span>
                        <span className="text-xs text-ledger-muted">
                          {f.situacao === "pendente" && f.atrasado
                            ? "Atrasado"
                            : f.situacao === "pendente"
                              ? "Pendente"
                              : f.situacao === "concluido"
                                ? "Concluído"
                                : "Cancelado"}
                        </span>
                        {f.observacao && (
                          <span className="min-w-[140px] flex-1 text-xs text-ledger-muted">
                            {f.observacao}
                          </span>
                        )}
                        {f.situacao === "pendente" && pode("candidaturas.followups") && (
                          <span className="ml-auto flex gap-1.5">
                            <button
                              type="button"
                              className="admin-btn"
                              onClick={() => concluir.mutate(f.id)}
                            >
                              <CheckCircle2 aria-hidden className="size-3.5" />
                              Concluir
                            </button>
                            <button
                              type="button"
                              className="admin-btn"
                              onClick={() => cancelar.mutate(f.id)}
                            >
                              <XCircle aria-hidden className="size-3.5" />
                              Cancelar
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </TabsContent>

            {/* AVALIAÇÕES — estrutura preparada, sem motor */}
            <TabsContent value="avaliacoes">
              <Panel title="Perfil e avaliações">
                <div className="rounded-lg border border-line-soft bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <ClipboardList aria-hidden className="size-5 text-bronze" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ledger-text">DISC</p>
                      <p className="text-xs text-ledger-muted">
                        {d.avaliacoes.find((a) => a.tipo === "disc")?.situacao === "nao_realizado"
                          ? "Não realizado"
                          : (d.avaliacoes.find((a) => a.tipo === "disc")?.situacao ?? "Não realizado")}
                      </p>
                    </div>
                    <button type="button" className="admin-btn" disabled title="Recurso preparado para futura ativação">
                      Enviar teste DISC
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-ledger-muted">
                    DISC, recurso preparado para futura ativação. Não existe questionário, pontuação
                    nem resultado neste sistema: a estrutura guarda apenas tipo, situação, data de
                    envio, data de conclusão e referência do resultado.
                  </p>
                </div>
                <div className="mt-4 rounded-lg border border-dashed border-line p-4">
                  <p className="text-sm font-semibold text-ledger-text">Links e avaliações</p>
                  <p className="mt-1 text-xs text-ledger-muted">
                    Aguardando ativação. Quando o instrumento for definido, cada candidata receberá
                    um link individual com token e validade. Nenhum link foi criado.
                  </p>
                </div>
              </Panel>
            </TabsContent>

            {/* DADOS TÉCNICOS */}
            <TabsContent value="dados" className="space-y-5">
              <Panel title="Origem e atribuição">
                <dl className="grid gap-5 md:grid-cols-2">
                  <Campo rotulo="Origem normalizada" valor={rotuloOrigem(d.origem.normalizada)} />
                  <Campo rotulo="Origem declarada no formulário" valor={d.origem.origem_bruta} />
                  <Campo
                    rotulo="First touch"
                    valor={rotuloOrigem(
                      (d.origem.first_touch as { source?: string })?.source ?? undefined,
                    )}
                  />
                  <Campo
                    rotulo="Last touch"
                    valor={rotuloOrigem(
                      (d.origem.last_touch as { source?: string })?.source ?? undefined,
                    )}
                  />
                  <Campo rotulo="Página de entrada" valor={d.origem.landing_page} />
                  <Campo rotulo="Referência" valor={d.origem.referrer ?? "Nenhuma informada"} />
                  <Campo
                    rotulo="Primeira referência"
                    valor={d.origem.first_referrer ?? "Nenhuma informada"}
                  />
                  <Campo
                    rotulo="Parâmetros de campanha"
                    valor={
                      Object.keys(d.origem.utm).length === 0 ? (
                        "Nenhum"
                      ) : (
                        <span className="num text-xs">{JSON.stringify(d.origem.utm)}</span>
                      )
                    }
                  />
                  <Campo rotulo="gclid" valor={d.origem.gclid} />
                  <Campo rotulo="fbclid" valor={d.origem.fbclid} />
                </dl>
                <JornadaEditorialCampos origem={d.origem} />
              </Panel>

              <Panel title="Dados técnicos do envio">
                {d.tecnico ? (
                  <>
                    <dl className="grid gap-5 md:grid-cols-3">
                      <Campo rotulo="IP" valor={<span className="num">{d.tecnico.ip}</span>} />
                      <Campo rotulo="Navegador" valor={d.tecnico.navegador} />
                      <Campo rotulo="Sistema" valor={d.tecnico.sistema} />
                      <Campo rotulo="Dispositivo" valor={d.tecnico.dispositivo} />
                      <Campo rotulo="Idioma" valor={d.tecnico.idioma} />
                    </dl>
                    <p className="mt-4 text-xs text-ledger-muted">
                      Dado pessoal tratado conforme a Política de Privacidade, para segurança,
                      atribuição de origem e prevenção de abuso. Visível apenas para perfis
                      autorizados e nunca exposto no site.
                    </p>
                  </>
                ) : (
                  <EmptyState
                    title="Dados técnicos restritos."
                    description="Seu perfil não tem permissão para ver IP e informações de navegação."
                  />
                )}
              </Panel>

              <Panel title={`Envios do formulário (${d.envios.length})`}>
                <ul className="space-y-2">
                  {d.envios.map((e) => (
                    <li key={e.id} className="rounded-lg border border-line-soft bg-surface p-3">
                      <p className="text-sm font-semibold text-ledger-text">
                        {e.reenvio ? "Nova candidatura recebida novamente" : "Candidatura recebida"}{" "}
                        em {dataHora(e.em)}
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel title="Histórico de etapas">
                {d.historico_etapas.length === 0 ? (
                  <EmptyState title="Sem movimentações." description="A candidatura segue na etapa de entrada." />
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {d.historico_etapas.map((h, i) => (
                      <li key={i} className="text-ledger-muted">
                        <span className="text-ledger-text">
                          {h.de ? `${h.de} → ${h.para}` : `Entrada em ${h.para}`}
                        </span>{" "}
                        · {dataHora(h.em)} · {h.autor ?? "sistema"}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </TabsContent>
          </Tabs>
        </div>

        {/* LATERAL */}
        <aside className="space-y-5">
          <Panel title="Próxima ação">
            <p
              className={cn(
                "text-sm font-semibold",
                p.tom === "atrasado" && "text-danger",
                p.tom === "hoje" && "text-success",
                p.tom === "nenhum" && "text-warning",
              )}
            >
              {p.texto}
            </p>
            <p className="mt-1 text-xs text-ledger-muted">
              Última atividade: {d.timeline[0] ? desde(d.timeline[0].em) : "—"}
            </p>
          </Panel>

          <Panel title="Atendimento">
            <div className="space-y-4">
              {pode("candidaturas.move") && (
                <div>
                  <span className="ledger-eyebrow mb-1.5 block">Etapa</span>
                  <SmartSelect
                    value={c.etapa_id}
                    onChange={(v) => mover.mutate(v)}
                    options={(opcoes.data?.etapas ?? [])
                      .filter((e) => e.ativa)
                      .map((e) => ({ value: e.id, label: e.nome }))}
                  />
                </div>
              )}
              {pode("candidaturas.assign") && (
                <div>
                  <span className="ledger-eyebrow mb-1.5 block">Responsável</span>
                  <SmartSelect
                    value={c.responsavel_id ?? ""}
                    onChange={(v) => responsavel.mutate(v)}
                    placeholder="Sem responsável"
                    options={(opcoes.data?.usuarios ?? []).map((u) => ({
                      value: u.id,
                      label: u.nome,
                    }))}
                  />
                </div>
              )}
              {pode("candidaturas.edit") && (
                <div>
                  <span className="ledger-eyebrow mb-1.5 block">Prioridade</span>
                  <SmartSelect
                    value={c.prioridade}
                    onChange={(v) => prioridade.mutate(v)}
                    options={[
                      { value: "normal", label: "Normal" },
                      { value: "alta", label: "Alta" },
                      { value: "urgente", label: "Urgente" },
                    ]}
                  />
                </div>
              )}
            </div>
          </Panel>

          {pode("candidaturas.tags") && (
            <Panel title="Etiquetas">
              <div className="flex flex-wrap gap-1.5">
                {(opcoes.data?.etiquetas ?? [])
                  .filter((t) => t.ativa !== false)
                  .map((t) => {
                    const ativa = tagsAplicadas.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => etiqueta.mutate({ tag: t.id, aplicar: !ativa })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.6875rem] font-semibold transition",
                          ativa ? "border-transparent" : "border-line text-ledger-muted",
                        )}
                        style={ativa ? { backgroundColor: `${t.cor}1a`, color: t.cor } : undefined}
                      >
                        <Tag aria-hidden className="size-3" />
                        {t.nome}
                      </button>
                    );
                  })}
              </div>
            </Panel>
          )}

          <Panel title="Ligação com cadastros">
            <p className="text-xs text-ledger-muted">
              {c.party_id ? (
                <Link
                  to="/admin/cadastros/pessoas/$id"
                  params={{ id: c.party_id }}
                  className="font-semibold text-bronze"
                >
                  Ver ficha de pessoa vinculada
                </Link>
              ) : (
                "Ainda sem pessoa vinculada. Candidatura aprovada não é consultora ativa: a conversão em consultora acontece no cadastro de pessoas, com contrato, região e maleta próprios."
              )}
            </p>
          </Panel>
        </aside>
      </div>

      <FollowupDialog
        leadId={id}
        nome={c.nome}
        opcoes={opcoes.data}
        aberto={abrirFollowup}
        onFechar={() => setAbrirFollowup(false)}
      />

      {/* GANHO */}
      <Dialog open={abrirGanho} onOpenChange={setAbrirGanho}>
        <DialogContent className="admin-scope max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar candidatura como aprovada</DialogTitle>
            <DialogDescription>
              Aprovada não significa consultora ativada. Nenhum cadastro de consultora é criado
              automaticamente.
            </DialogDescription>
          </DialogHeader>
          <textarea
            rows={3}
            value={obsGanho}
            onChange={(e) => setObsGanho(e.target.value)}
            placeholder="Observação (opcional)"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <DialogFooter>
            <button type="button" className="admin-btn" onClick={() => setAbrirGanho(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={ganho.isPending}
              onClick={() => ganho.mutate(obsGanho, { onSuccess: () => setAbrirGanho(false) })}
            >
              Confirmar aprovação
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PERDA */}
      <Dialog open={abrirPerda} onOpenChange={setAbrirPerda}>
        <DialogContent className="admin-scope max-w-md">
          <DialogHeader>
            <DialogTitle>Por que esta candidatura foi perdida?</DialogTitle>
            <DialogDescription>
              A candidatura continua consultável e pode ser reaberta depois.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <SmartSelect
              value={motivoPerda}
              onChange={setMotivoPerda}
              placeholder="Escolher motivo"
              options={(opcoes.data?.motivos_perda ?? []).map((m) => ({
                value: m.id,
                label: m.rotulo,
              }))}
            />
            <textarea
              rows={3}
              value={obsPerda}
              onChange={(e) => setObsPerda(e.target.value)}
              placeholder="Observação"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <button type="button" className="admin-btn" onClick={() => setAbrirPerda(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={perda.isPending || !motivoPerda}
              onClick={() =>
                perda.mutate(
                  { motivo: motivoPerda, obs: obsPerda },
                  { onSuccess: () => setAbrirPerda(false) },
                )
              }
            >
              Confirmar perda
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

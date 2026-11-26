/**
 * 0402 — Captação › Conversas: o que a Lara está falando no WhatsApp, para a equipe intervir.
 * "Precisa de pessoa" = a Lara parou e passou para a equipe (dúvida, pedido de pessoa, revisão…).
 * Responder assume a conversa (a Lara para de responder sozinha) até alguém "Devolver para a Lara".
 * A Meta só deixa responder em até 24 h depois da última mensagem dela.
 * Configuração (só Master): segredos presentes, número, modelos, ligar/desligar.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Check, CheckCheck, CircleAlert, Hand, Send, Settings2, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/admin/ui";
import { laraAtivarNumero, laraEnviarModelos, laraPainel, type PainelLara } from "@/lib/lara/lara.functions";
import { cn } from "@/lib/utils";

type Item = {
  lead_id: string; nome: string; cidade: string; uf: string; estado: string; humano: boolean; humano_motivo: string | null; opt_out: boolean;
  nao_lidas: number; revisao: boolean; janela_aberta: boolean | null;
  ultima: { texto: string | null; em: string; direcao: "entrada" | "saida"; autor: string; status: string } | null;
};
type Lista = { ativa: boolean; contagem: { pessoa: number; revisao: number; nao_lidas: number }; itens: Item[]; sem_candidatura: number };
type Msg = { id: string; direcao: "entrada" | "saida"; autor: "candidata" | "lara" | "equipe"; tipo: string; texto: string | null; template: string | null; status: string; erro: string | null; em: string };
type Conversa = {
  lead_id: string; nome: string; protocolo: string; cidade: string; uf: string; wa_id: string; estado: string; humano: boolean; humano_motivo: string | null;
  opt_out: boolean; como_conheceu: string | null; outcome: string; janela_aberta: boolean | null; janela_ate: string | null;
  revisao: { id: string; pedido_em: string; texto: string | null } | null; na_fila: number; mensagens: Msg[];
};

export const ESTADO_LARA: Record<string, string> = {
  nova: "Começando", msg1: "Mensagem 1 enviada", msg2: "Explicou o consignado", teste: "Link do teste enviado", lembrete: "Lembrete enviado",
  teste_feito: "Teste feito", pensando: "Vai pensar", desistiu: "Sem interesse agora", expirada: "Expirou sem teste",
  aprovada: "Aprovada (link dos documentos)", recusada: "Recusada (pode pedir revisão)", revisao_pedida: "Pediu revisão",
};
const COMO: Record<string, string> = { indicacao: "Indicação", instagram: "Instagram", google: "Google", outro: "Outro" };

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(f as never, a as never);
  if (error) throw new Error(error.message.includes("sem_permissao") ? "Sem permissão." : error.message);
  return data as T;
}
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function Conversas({ podeEditar }: { podeEditar: boolean }) {
  const [filtro, setFiltro] = React.useState<"todas" | "pessoa" | "nao_lidas" | "revisao">("todas");
  const [busca, setBusca] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const lista = useQuery({
    queryKey: ["crm", "lara", "lista", filtro, busca],
    queryFn: () => rpc<Lista>("lara_conversas_lista", { _filtro: filtro, _busca: busca || null, _limite: 150 }),
    refetchInterval: 15_000,
  });
  const master = useQuery({
    queryKey: ["eu", "master"], staleTime: 300_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "master" });
      return data === true;
    },
  });

  if (lista.isLoading) return <Skeleton className="h-[480px] w-full" />;
  if (lista.error) return <ErrorState message={(lista.error as Error).message} onRetry={() => void lista.refetch()} />;
  const d = lista.data!;
  const itens = d.itens;
  const atual = sel ?? itens[0]?.lead_id ?? null;
  return (
    <div className="space-y-4">
      {master.data && <Configuracao ativa={d.ativa} />}
      {!d.ativa && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          A Lara está <strong>desligada</strong>: ninguém recebe mensagem automática. As mensagens que chegarem ficam gravadas aqui.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["todas", "Todas"], ["pessoa", `Precisa de pessoa · ${d.contagem.pessoa}`], ["nao_lidas", `Não lidas · ${d.contagem.nao_lidas}`], ["revisao", `Pediram revisão · ${d.contagem.revisao}`],
        ] as const).map(([v, r]) => (
          <button key={v} type="button" onClick={() => { setFiltro(v); setSel(null); }}
            className={cn("rounded-lg px-3 py-1.5 text-[0.8125rem] font-semibold", filtro === v ? "bg-champagne-soft text-bronze" : "text-ledger-muted hover:text-ledger-text")}>{r}</button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou número"
          className="ml-auto h-9 w-56 rounded-lg border border-line bg-surface px-3 text-sm" aria-label="Buscar conversa" />
      </div>
      {d.sem_candidatura > 0 && (
        <p className="text-xs text-ledger-muted">{d.sem_candidatura} número(s) sem candidatura escreveram nos últimos 30 dias. A Lara respondeu explicando como se candidatar.</p>
      )}
      {itens.length === 0 ? (
        <EmptyState title="Nenhuma conversa aqui." description="Quando a Lara falar com alguma candidata, a conversa aparece nesta tela." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <ul className="max-h-[70vh] divide-y divide-line-soft overflow-auto rounded-xl border border-line bg-surface">
            {itens.map((c) => (
              <li key={c.lead_id}>
                <button type="button" onClick={() => setSel(c.lead_id)} aria-current={atual === c.lead_id}
                  className={cn("w-full px-4 py-3 text-left hover:bg-warm-ivory/60", atual === c.lead_id && "bg-champagne-soft/60")}>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.nome}</span>
                    {c.nao_lidas > 0 && <span className="rounded-full bg-bronze px-1.5 text-[0.6875rem] font-semibold text-primary-foreground">{c.nao_lidas}</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-1 text-[0.6875rem]">
                    {c.humano && <span className="rounded-full bg-warning/15 px-1.5 font-semibold text-warning">Pessoa</span>}
                    {c.revisao && <span className="rounded-full bg-danger/15 px-1.5 font-semibold text-danger">Revisão</span>}
                    {c.opt_out && <span className="rounded-full bg-surface-muted px-1.5 text-ledger-muted">Pediu para sair</span>}
                    <span className="text-ledger-muted">{ESTADO_LARA[c.estado] ?? c.estado}</span>
                  </span>
                  {c.ultima && <span className="mt-1 block truncate text-xs text-ledger-muted">{c.ultima.direcao === "saida" ? (c.ultima.autor === "equipe" ? "Equipe: " : "Lara: ") : ""}{c.ultima.texto}</span>}
                </button>
              </li>
            ))}
          </ul>
          {atual && <Detalhe key={atual} lead={atual} podeEditar={podeEditar} />}
        </div>
      )}
    </div>
  );
}

function Detalhe({ lead, podeEditar }: { lead: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const chave = ["crm", "lara", "conversa", lead];
  const q = useQuery({ queryKey: chave, queryFn: () => rpc<Conversa | null>("lara_conversa_ver", { _lead: lead }), refetchInterval: 8000 });
  const [texto, setTexto] = React.useState("");
  const fimRef = React.useRef<HTMLDivElement>(null);
  const recarregar = () => { void qc.invalidateQueries({ queryKey: chave }); void qc.invalidateQueries({ queryKey: ["crm", "lara", "lista"] }); };
  const assumir = useMutation({ mutationFn: (v: boolean) => rpc("lara_assumir", { _lead: lead, _assumir: v }), onSuccess: recarregar, onError: (e: Error) => toast.error(e.message) });
  const responder = useMutation({
    mutationFn: () => rpc("lara_responder", { _lead: lead, _texto: texto }),
    onSuccess: () => { setTexto(""); toast.success("Na fila: sai em instantes."); recarregar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolver = useMutation({ mutationFn: (id: string) => rpc("captacao_revisao_resolver", { _id: id }), onSuccess: recarregar, onError: (e: Error) => toast.error(e.message) });
  React.useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [q.data?.mensagens.length]);

  if (q.isLoading) return <Skeleton className="h-[480px] w-full" />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const c = q.data;
  if (!c) return <EmptyState title="Conversa não encontrada." description="" />;
  const podeResponder = podeEditar && !c.opt_out && !!c.janela_aberta;
  return (
    <Panel
      title={c.nome}
      action={<Link to="/admin/candidaturas/$id" params={{ id: c.lead_id }} className="text-xs font-semibold text-bronze">Abrir ficha</Link>}
      flush
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 text-xs">
        <span className="text-ledger-muted">{c.cidade}/{c.uf} · +{c.wa_id} · {ESTADO_LARA[c.estado] ?? c.estado}{c.como_conheceu ? ` · Conheceu por ${COMO[c.como_conheceu] ?? c.como_conheceu}` : ""}</span>
        <span className="ml-auto flex gap-2">
          {podeEditar && (c.humano
            ? <button type="button" className="admin-btn inline-flex items-center gap-1.5" disabled={assumir.isPending} onClick={() => assumir.mutate(false)}><Bot className="size-4" aria-hidden /> Devolver para a Lara</button>
            : <button type="button" className="admin-btn inline-flex items-center gap-1.5" disabled={assumir.isPending} onClick={() => assumir.mutate(true)}><Hand className="size-4" aria-hidden /> Assumir conversa</button>)}
        </span>
      </div>
      {c.humano && <p className="border-b border-line bg-warning/10 px-5 py-2 text-xs">A Lara parou de responder sozinha{c.humano_motivo ? `: ${c.humano_motivo}` : ""}.</p>}
      {c.revisao && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-danger/5 px-5 py-2 text-xs">
          <CircleAlert className="size-4 text-danger" aria-hidden /> Pediu revisão da recusa em {hora(c.revisao.pedido_em)}. Reveja na ficha e responda aqui.
          {podeEditar && <button type="button" className="admin-btn ml-auto" disabled={resolver.isPending} onClick={() => resolver.mutate(c.revisao!.id)}>Marcar como resolvido</button>}
        </div>
      )}
      <div className="max-h-[52vh] space-y-2 overflow-auto bg-warm-ivory/40 px-5 py-4" aria-live="polite">
        {c.mensagens.map((m) => (
          <div key={m.id} className={cn("flex", m.direcao === "saida" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm", m.direcao === "saida" ? (m.autor === "equipe" ? "bg-champagne-soft" : "bg-surface") : "bg-surface-muted")}>
              <p className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-semibold text-ledger-muted">
                {m.direcao === "entrada" ? <UserRound className="size-3" aria-hidden /> : m.autor === "equipe" ? <Hand className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
                {m.direcao === "entrada" ? "Candidata" : m.autor === "equipe" ? "Equipe" : "Lara"}{m.template ? " · modelo" : ""}
              </p>
              <p className="whitespace-pre-line break-words">{m.texto}</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-[0.625rem] text-ledger-muted">
                {hora(m.em)}
                {m.direcao === "saida" && (m.status === "lida" ? <CheckCheck className="size-3 text-info" aria-label="Lida" /> : m.status === "entregue" ? <CheckCheck className="size-3" aria-label="Entregue" /> : m.status === "falhou" ? <CircleAlert className="size-3 text-danger" aria-label="Falhou" /> : <Check className="size-3" aria-label="Enviada" />)}
              </p>
              {m.status === "falhou" && m.erro && <p className="text-[0.6875rem] text-danger">{m.erro}</p>}
            </div>
          </div>
        ))}
        {c.na_fila > 0 && <p className="text-center text-[0.6875rem] text-ledger-muted">{c.na_fila} mensagem(ns) na fila, saindo…</p>}
        <div ref={fimRef} />
      </div>
      {podeEditar && (
        <div className="border-t border-line px-5 py-3">
          {c.opt_out ? (
            <p className="text-xs text-ledger-muted">Ela pediu para não receber mensagens. Ninguém da Lardan manda mais nada por aqui.</p>
          ) : !c.janela_aberta ? (
            <p className="text-xs text-ledger-muted">Passaram 24 horas desde a última mensagem dela. A Meta só deixa responder quando ela escrever de novo (ou por um modelo aprovado).</p>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) responder.mutate(); }}>
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={3000} aria-label="Responder"
                placeholder="Responder como Lardan (assume a conversa)" className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              <button type="submit" disabled={!podeResponder || !texto.trim() || responder.isPending} className="admin-btn admin-btn-primary inline-flex items-center gap-1.5 self-end">
                <Send className="size-4" aria-hidden /> Enviar
              </button>
            </form>
          )}
          {c.janela_aberta && c.janela_ate && <p className="mt-1 text-[0.6875rem] text-ledger-muted">Dá para responder até {hora(c.janela_ate)}.</p>}
        </div>
      )}
    </Panel>
  );
}

const ROTULO_SEGREDO: Record<string, string> = {
  WHATSAPP_TOKEN: "Token do usuário do sistema", WHATSAPP_APP_SECRET: "Chave secreta do app", WHATSAPP_PIN: "PIN de 6 dígitos do número",
  WHATSAPP_VERIFY_TOKEN: "Frase de verificação do webhook", WHATSAPP_PHONE_NUMBER_ID: "ID do número", WHATSAPP_WABA_ID: "ID da conta do WhatsApp",
};
const STATUS_MODELO: Record<string, string> = { APPROVED: "Aprovado", PENDING: "Em análise", REJECTED: "Recusado", PAUSED: "Pausado", DISABLED: "Desativado" };

function Configuracao({ ativa }: { ativa: boolean }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = React.useState(!ativa);
  const painelFn = useServerFn(laraPainel);
  const ativarFn = useServerFn(laraAtivarNumero);
  const modelosFn = useServerFn(laraEnviarModelos);
  const p = useQuery({ queryKey: ["crm", "lara", "painel"], enabled: aberto, queryFn: () => painelFn() as Promise<PainelLara> });
  const ativar = useMutation({ mutationFn: () => ativarFn(), onSuccess: () => { toast.success("Número ativado na API."); void p.refetch(); }, onError: (e: Error) => toast.error(e.message) });
  const modelos = useMutation({
    mutationFn: () => modelosFn() as Promise<{ enviados: string[]; erros: { nome: string; erro: string }[] }>,
    onSuccess: (r) => { toast.success(r.enviados.length ? `${r.enviados.length} modelo(s) enviado(s) para aprovação.` : "Todos os modelos já estavam na Meta."); if (r.erros.length) toast.error(r.erros.map((e) => `${e.nome}: ${e.erro}`).join("\n")); void p.refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ligar = useMutation({
    mutationFn: (v: boolean) => rpc<boolean>("lara_ligar", { _ativa: v }),
    onSuccess: (v) => { toast.success(v ? "Lara ligada." : "Lara desligada."); void qc.invalidateQueries({ queryKey: ["crm", "lara"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = p.data;
  const faltam = d ? Object.entries(d.segredos).filter(([, ok]) => !ok).map(([k]) => k) : [];
  const aprovados = d?.modelos.filter((m) => m.status === "APPROVED").length ?? 0;
  const pronta = d && faltam.length === 0 && d.numero?.status === "CONNECTED" && aprovados === 4;
  return (
    <Panel title="Configuração da Lara (Master)" action={<button type="button" className="admin-btn inline-flex items-center gap-1.5" onClick={() => setAberto((v) => !v)}><Settings2 className="size-4" aria-hidden /> {aberto ? "Fechar" : "Abrir"}</button>}>
      {!aberto ? (
        <p className="text-sm text-ledger-muted">Lara {ativa ? "ligada" : "desligada"}.</p>
      ) : p.isLoading ? <Skeleton className="h-40 w-full" /> : p.error ? <ErrorState message={(p.error as Error).message} onRetry={() => void p.refetch()} /> : d && (
        <div className="space-y-4 text-sm">
          <div>
            <p className="ledger-eyebrow mb-1">1. Segredos no Lovable (só mostra se existem)</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {Object.entries(d.segredos).map(([k, ok]) => (
                <li key={k} className={cn("flex items-center gap-1.5", ok ? "text-success" : "text-danger")}>{ok ? <Check className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}{ROTULO_SEGREDO[k] ?? k}</li>
              ))}
            </ul>
          </div>
          {d.erro && <p className="text-danger">Meta: {d.erro}</p>}
          <div>
            <p className="ledger-eyebrow mb-1">2. Número</p>
            {d.numero ? (
              <p>{d.numero.numero} · {d.numero.nome} · status <strong>{d.numero.status ?? "—"}</strong> · nome {d.numero.nome_status ?? "—"} · qualidade {d.numero.qualidade ?? "—"}</p>
            ) : <p className="text-ledger-muted">Aparece quando o token e os IDs estiverem nos segredos.</p>}
            <button type="button" className="admin-btn mt-2" disabled={faltam.length > 0 || ativar.isPending} onClick={() => ativar.mutate()}>
              {ativar.isPending ? "Ativando…" : "Ativar número na API"}
            </button>
          </div>
          <div>
            <p className="ledger-eyebrow mb-1">3. Modelos de mensagem ({aprovados} de 4 aprovados)</p>
            {d.modelos.length ? (
              <ul className="space-y-0.5">{d.modelos.map((m) => <li key={m.nome}>{m.nome}: <strong>{STATUS_MODELO[m.status] ?? m.status}</strong>{m.motivo ? ` (${m.motivo})` : ""}</li>)}</ul>
            ) : <p className="text-ledger-muted">Nenhum modelo da Lara na Meta ainda.</p>}
            <button type="button" className="admin-btn mt-2" disabled={faltam.length > 0 || modelos.isPending} onClick={() => modelos.mutate()}>
              {modelos.isPending ? "Enviando…" : "Enviar modelos para aprovação"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <p className="font-semibold">4. Lara {ativa ? "ligada" : "desligada"}</p>
            {ativa
              ? <button type="button" className="admin-btn" disabled={ligar.isPending} onClick={() => ligar.mutate(false)}>Desligar</button>
              : <button type="button" className="admin-btn admin-btn-primary" disabled={ligar.isPending || !pronta} onClick={() => ligar.mutate(true)}>Ligar a Lara</button>}
            {!ativa && !pronta && <span className="text-xs text-ledger-muted">Libera quando os segredos, o número conectado e os 4 modelos aprovados estiverem ok.</span>}
          </div>
        </div>
      )}
    </Panel>
  );
}

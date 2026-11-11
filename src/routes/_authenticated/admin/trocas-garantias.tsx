import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Camera, Clock3, Lock, MessageSquare, PackageCheck, Plus, Search, Send, ShieldCheck, Store, Smartphone, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, EmptyState, ErrorState, StatusBadge, type StatusTone } from "@/components/admin/ui";
import { useCapabilities } from "@/lib/capabilities";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { FotoPeca } from "@/components/FotoPeca";
import { PecaTrocaPicker } from "@/components/qualidade/PecaTrocaPicker";
import { TrocaCorreios } from "@/components/qualidade/TrocaCorreios";
import { RecebimentoMaletas } from "@/components/qualidade/RecebimentoMaletas";
import { AcertosPainel } from "@/components/admin/maletas/AcertosPainel";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";
import { cn } from "@/lib/utils";
import {
  STATUS_TROCA, SOLUCAO_TROCA, MOTIVOS_TROCA, proximosStatus, protocoloTroca, brlTroca, eventosTroca, enviarFotosTroca, urlsFotosTroca,
  dataHora, diasDesde, diferencaTroca, type Troca, type StatusTroca, type SolucaoTroca, type PecaBusca,
} from "@/lib/qualidade-trocas";

export const Route = createFileRoute("/_authenticated/admin/trocas-garantias")({
  validateSearch: (s: Record<string, unknown>): { setor?: "recebimento" | "conferencia" } =>
    (s["setor"] === "recebimento" || s["setor"] === "conferencia" ? { setor: s["setor"] } : {}),
  component: Qualidade,
  head: () => ({
    meta: [
      { title: "Trocas e garantias — LARDAN Cloud" },
      { name: "description", content: "Setor de Qualidade Lardan: trocas e garantias das consultoras com devolutiva e histórico." },
      { property: "og:title", content: "Trocas e garantias — LARDAN" },
      { property: "og:description", content: "Canal de mão dupla entre a Qualidade Lardan e as consultoras." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Resumo = Record<string, number | null>;
const ABAS: { id: string; label: string }[] = [
  { id: "aberta", label: "Abertas" },
  { id: "em_analise", label: "Em análise" },
  { id: "aguardando_envio", label: "Aguardando envio" },
  { id: "novidades", label: "Novidades das consultoras" },
  { id: "resolvida", label: "Finalizadas" },
  { id: "recusada", label: "Recusadas" },
  { id: "todas", label: "Todas" },
];
const TOM: Record<StatusTroca, StatusTone> = { aberta: "warning", em_analise: "info", aguardando_envio: "info", resolvida: "success", recusada: "danger" };
const POR_PAGINA = 50;

/** 0281: o setor de Qualidade tem duas frentes — trocas/garantias e o recebimento das maletas que voltam. */
function Qualidade() {
  const { setor } = Route.useSearch();
  const navigate = Route.useNavigate();
  const caps = useCapabilities();
  const ir = (s?: "recebimento" | "conferencia") => void navigate({ search: s ? { setor: s } : {}, replace: true });
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Setor de Qualidade" className="inline-flex gap-1 rounded-full border border-line bg-surface p-1">
        {([["recebimento", "Conferência de maletas que voltam"], [undefined, "Trocas e garantias"], ["conferencia", "Conferência de peças"]] as const).map(([id, rot]) => (
          <button key={rot} type="button" role="tab" aria-selected={setor === id} onClick={() => ir(id)}
            className={cn("rounded-full px-4 py-2 text-sm font-semibold transition", setor === id ? "bg-bronze text-primary-foreground" : "text-ledger-text hover:bg-muted")}>{rot}</button>
        ))}
      </div>
      {setor === "recebimento" ? (
        <div className="space-y-6">
          <PageHeader eyebrow="Setor de Qualidade" title="Recebimento de maletas" icon={PackageCheck}
            description="Toda maleta que volta para a empresa passa aqui: do acerto (consultora → representante → empresa) ou que não ficou com a consultora." />
          <RecebimentoMaletas />
        </div>
      ) : setor === "conferencia" ? (
        <div className="space-y-6">
          <PageHeader eyebrow="Setor de Qualidade" title="Conferência de peças" icon={PackageCheck}
            description="Acertos esperando a bipagem das peças que voltaram. Abra a maleta para conferir peça por peça; as peças voltam ao estoque pela conferência oficial." />
          {caps.includes("kit.manage") ? <AcertosPainel /> : <p role="alert" className="text-sm text-ledger-muted">A conferência de peças é feita por quem tem acesso à montagem de maletas.</p>}
        </div>
      ) : <TrocasGarantias />}
    </div>
  );
}

function TrocasGarantias() {
  const caps = useCapabilities();
  const ver = caps.includes("quality.view");
  const gerir = caps.includes("quality.manage");
  const [aba, setAba] = React.useState("aberta");
  const [termo, setTermo] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [pagina, setPagina] = React.useState(0);
  const [selecionada, setSelecionada] = React.useState<string>("");
  const [nova, setNova] = React.useState(false);
  const buscaRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { const t = setTimeout(() => { setBusca(termo.trim()); setPagina(0); }, 300); return () => clearTimeout(t); }, [termo]);
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); buscaRef.current?.focus(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);

  const resumo = useQuery({ queryKey: ["qualidade", "resumo"], enabled: ver, queryFn: async () => { const { data, error } = await supabase.rpc("qualidade_troca_resumo"); if (error) throw error; return data as unknown as Resumo; } });
  const lista = useQuery({
    queryKey: ["qualidade", "lista", busca ? "todas" : aba, busca, pagina], enabled: ver, placeholderData: keepPreviousData,
    queryFn: async () => { const { data, error } = await supabase.rpc("qualidade_troca_buscar", { _termo: busca, _status: busca ? "todas" : aba, _limite: POR_PAGINA, _offset: pagina * POR_PAGINA }); if (error) throw error; return data as unknown as { total: number; itens: Troca[] }; },
  });
  const itens = lista.data?.itens ?? [];
  const atual = itens.find((i) => i.id === selecionada) ?? null;

  if (!ver) return <p role="alert" className="p-6">Acesso não liberado para trocas e garantias.</p>;
  const r = resumo.data ?? {};
  const n = (k: string) => Number(r[k] ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Setor de Qualidade" title="Trocas e garantias" icon={ShieldCheck}
        description="Canal direto com as consultoras: o que elas abrem no app chega aqui, e a sua devolutiva aparece no app delas."
        actions={gerir ? <Button onClick={() => setNova(true)} className="gap-2"><Plus className="size-4" aria-hidden /> Nova troca</Button> : undefined} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi rotulo="Abertas" valor={n("aberta")} destaque={n("aberta") > 0} />
        <Kpi rotulo="Em análise" valor={n("em_analise")} />
        <Kpi rotulo="Aguardando envio" valor={n("aguardando_envio")} />
        <Kpi rotulo="Novidades" valor={n("novidades")} destaque={n("novidades") > 0} dica="Mensagens e pedidos novos das consultoras" />
        <Kpi rotulo="Paradas +30 dias" valor={n("abertas_mais_30d")} alerta={n("abertas_mais_30d") > 0} />
        <Kpi rotulo="Consultoras pendentes" valor={n("consultoras_pendentes")} />
        <Kpi rotulo="Finalizadas 30 dias" valor={n("resolvidas_30d")} />
        <Kpi rotulo="Tempo médio" valor={r["dias_medios_resolucao"] == null ? "—" : `${String(r["dias_medios_resolucao"]).replace(".", ",")} dias`} dica="Abertura até finalização, últimos 180 dias" />
      </div>

      <Panel flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-6 py-4">
          <div role="tablist" aria-label="Situação" className="flex flex-wrap gap-1.5">
            {ABAS.map((a) => {
              const qtd = a.id === "todas" ? n("todas") : n(a.id);
              const on = !busca && aba === a.id;
              return (
                <button key={a.id} role="tab" aria-selected={on} type="button" onClick={() => { setAba(a.id); setTermo(""); setBusca(""); setPagina(0); setSelecionada(""); }}
                  className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold transition", on ? "border-bronze bg-bronze text-primary-foreground" : "border-line bg-surface text-ledger-text hover:border-champagne")}>
                  {a.label} <span className={cn("ml-1 tabular-nums", on ? "opacity-90" : "text-ledger-muted")}>{qtd.toLocaleString("pt-BR")}</span>
                </button>
              );
            })}
          </div>
          <label className="relative ml-auto w-full max-w-md">
            <span className="sr-only">Buscar trocas</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ledger-muted" aria-hidden />
            <input ref={buscaRef} value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Código ou nome da consultora, CPF, referência, protocolo, praça  ( / )"
              className="admin-input h-11 w-full pl-9" />
          </label>
        </div>
        {busca && <p className="px-6 pt-3 text-sm text-ledger-muted">Buscando “{busca}” em todas as situações · {lista.data?.total ?? "…"} resultado(s)</p>}
        <div className="grid min-h-[34rem] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="min-w-0 border-line-soft xl:border-r">
            {lista.isLoading && <p className="px-6 py-8 text-ledger-muted">Carregando trocas…</p>}
            {lista.isError && <div className="px-6"><ErrorState message={traduzir(lista.error)} onRetry={() => void lista.refetch()} /></div>}
            {lista.data && itens.length === 0 && <div className="px-6"><EmptyState title="Sem trocas aqui" description={busca ? "Nada encontrado para essa busca." : "Nenhuma troca nesta situação."} /></div>}
            {itens.length > 0 && (
              <table className="w-full table-fixed text-sm">
                <colgroup><col className="w-[8.5rem]" /><col className="w-[28%]" /><col /><col className="w-[6.5rem]" /><col className="w-[8.5rem]" /></colgroup>
                <thead className="sticky top-0 bg-cream-2 text-left text-[0.7rem] uppercase tracking-[0.12em] text-ledger-muted">
                  <tr><th className="px-6 py-3">Protocolo</th><th className="px-3 py-3">Consultora</th><th className="px-3 py-3">Peça</th><th className="px-3 py-3">Aberta</th><th className="px-4 py-3 text-right">Situação</th></tr>
                </thead>
                <tbody>
                  {itens.map((t) => (
                    <tr key={t.id} onClick={() => setSelecionada(t.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelecionada(t.id); }}
                      aria-selected={t.id === selecionada}
                      className={cn("cursor-pointer border-t border-line-soft align-top transition hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none", t.id === selecionada && "bg-champagne/15")}>
                      <td className="px-6 py-3">
                        <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold tabular-nums">
                          {t.novidade_lardan && <span className="size-2 rounded-full bg-danger" title="Novidade da consultora" aria-label="Novidade da consultora" />}
                          {protocoloTroca(t.protocolo)}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ledger-muted"><Origem o={t.origem} />{t.legado_id ? <span className="whitespace-nowrap">nº {t.legado_id}</span> : null}</span>
                      </td>
                      <td className="px-3 py-3"><span className="line-clamp-2 font-medium">[Cód. {t.consultora_codigo ?? "—"}] {t.consultora_nome}</span><span className="block truncate text-xs text-ledger-muted">{t.praca_nome ?? "Praça não informada"}</span></td>
                      <td className="px-3 py-3"><span className="font-medium">{t.dev_referencia ?? "—"}</span><span className="line-clamp-2 text-xs text-ledger-muted">{t.dev_nome}</span></td>
                      <td className="px-3 py-3 tabular-nums">{dataHora(t.aberto_em).split(" ")[0]}<span className="block text-xs text-ledger-muted">{["resolvida", "recusada"].includes(t.status) ? `em ${diasDesde(t.aberto_em, t.finalizado_em)} dias` : `há ${diasDesde(t.aberto_em)} dias`}</span></td>
                      <td className="px-4 py-3 text-right"><StatusBadge tone={TOM[t.status]}>{STATUS_TROCA[t.status]}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {lista.data && lista.data.total > POR_PAGINA && (
              <div className="flex items-center justify-between border-t border-line-soft px-6 py-3 text-sm">
                <span className="text-ledger-muted">{pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, lista.data.total)} de {lista.data.total.toLocaleString("pt-BR")}</span>
                <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={(pagina + 1) * POR_PAGINA >= lista.data.total} onClick={() => setPagina((p) => p + 1)}>Próxima</Button></span>
              </div>
            )}
          </div>
          <div className="min-w-0">
            {atual ? <Detalhe key={atual.id} t={atual} gerir={gerir} onMovido={(st) => { if (!busca) setAba(st); }} /> : <div className="px-6"><EmptyState title="Escolha uma troca" description="Clique numa linha para ver a peça, as fotos, a conversa com a consultora e dar a devolutiva." /></div>}
          </div>
        </div>
      </Panel>
      {gerir && <NovaTroca aberto={nova} onClose={() => setNova(false)} onCriada={(id) => { setAba("aberta"); setTermo(""); setBusca(""); setSelecionada(id); }} />}
    </div>
  );
}

function Kpi({ rotulo, valor, destaque, alerta, dica }: { rotulo: string; valor: number | string; destaque?: boolean; alerta?: boolean; dica?: string }) {
  return (
    <div title={dica} className={cn("ledger-panel px-4 py-3.5", destaque && "ring-1 ring-bronze/50", alerta && "ring-1 ring-danger/50")}>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ledger-muted">{rotulo}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", alerta && "text-danger")}>{typeof valor === "number" ? valor.toLocaleString("pt-BR") : valor}</p>
    </div>
  );
}

function Origem({ o }: { o: Troca["origem"] }) {
  if (o === "app_consultora") return <span className="inline-flex items-center gap-1 text-bronze"><Smartphone className="size-3" aria-hidden />App</span>;
  if (o === "admin_manual") return <span className="inline-flex items-center gap-1"><Store className="size-3" aria-hidden />Lardan</span>;
  return <span className="inline-flex items-center gap-1"><History className="size-3" aria-hidden />SmallData</span>;
}

function Fotos({ paths }: { paths: string[] }) {
  const q = useQuery({ queryKey: ["qualidade", "fotos", paths], enabled: paths.length > 0, queryFn: () => urlsFotosTroca(paths), staleTime: 5 * 60_000 });
  if (paths.length === 0) return null;
  if (q.isLoading) return <p className="text-xs text-ledger-muted">Carregando fotos…</p>;
  return <div className="mt-2 grid grid-cols-3 gap-2">{q.data?.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line"><img src={u} alt="Foto enviada na troca" className="aspect-square w-full object-cover" /></a>)}</div>;
}

function Detalhe({ t, gerir, onMovido }: { t: Troca; gerir: boolean; onMovido: (s: StatusTroca) => void }) {
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: ["qualidade", "eventos", t.id], queryFn: () => eventosTroca(t.id) });
  React.useEffect(() => {
    if (!t.novidade_lardan) return;
    void supabase.rpc("qualidade_troca_marcar_lida", { _id: t.id }).then(() => { void qc.invalidateQueries({ queryKey: ["qualidade", "resumo"] }); });
  }, [t.id, t.novidade_lardan, qc]);
  const opcoes = proximosStatus(t.status);
  const [destino, setDestino] = React.useState<StatusTroca>(t.status === "aberta" ? "em_analise" : t.status === "em_analise" ? "aguardando_envio" : t.status === "aguardando_envio" ? "resolvida" : "em_analise");
  const [solucao, setSolucao] = React.useState<SolucaoTroca | "">(t.solucao ?? "");
  const [rep, setRep] = React.useState<PecaBusca | null>(null);
  const [parecer, setParecer] = React.useState("");
  const invalidar = () => { void qc.invalidateQueries({ queryKey: ["qualidade"] }); };
  const mover = useMutation({
    mutationFn: async () => {
      const dados: { solucao?: string; rep_variant_id?: string } = {};
      if (solucao) dados.solucao = solucao;
      if (rep) dados.rep_variant_id = rep.id;
      const { error } = await supabase.rpc("qualidade_troca_mover", { _id: t.id, _status: destino, _texto: parecer, _dados: dados });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`${protocoloTroca(t.protocolo)}: ${STATUS_TROCA[destino]}. A consultora já vê no app.`); setParecer(""); onMovido(destino); invalidar(); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const difPrevista = solucao === "troca" && rep ? diferencaTroca(t.dev_valor_cents, rep.valor_cents) : solucao === "mesma_peca" || solucao === "conserto" ? 0 : t.diferenca_cents;
  const fotosAbertura = Array.isArray(t.fotos) ? t.fotos : [];

  return (
    <div className="space-y-5 px-6 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ledger-muted">{t.tipo === "garantia" ? "Garantia" : "Troca"} · <Origem o={t.origem} /></p>
          <h2 className="text-2xl font-bold tabular-nums">{protocoloTroca(t.protocolo)}</h2>
          <p className="text-sm">[Cód. {t.consultora_codigo}] <strong>{t.consultora_nome}</strong>{t.praca_nome ? ` · ${t.praca_nome}` : ""}</p>
        </div>
        <StatusBadge tone={TOM[t.status]}>{STATUS_TROCA[t.status]}</StatusBadge>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Peca titulo="Peça devolvida" variant={t.dev_variant_id} ref_={t.dev_referencia} nome={t.dev_nome} tam={t.dev_tamanho} valor={t.dev_valor_cents} />
        {(t.rep_referencia || t.rep_nome) ? <Peca titulo="Peça enviada" variant={t.rep_variant_id} ref_={t.rep_referencia} nome={t.rep_nome} tam={t.rep_tamanho} valor={t.rep_valor_cents} />
          : <div className="rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ledger-muted">Peça de reposição ainda não definida.</div>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-ledger-muted">Motivo</dt><dd>{t.motivo ?? "—"}{t.observacao ? ` · ${t.observacao}` : ""}</dd>
        <dt className="text-ledger-muted">Aberta por</dt><dd>{t.aberto_por_nome ?? "—"} · {dataHora(t.aberto_em)}</dd>
        {t.solucao && <><dt className="text-ledger-muted">Solução</dt><dd>{SOLUCAO_TROCA[t.solucao]}</dd></>}
        {t.diferenca_cents != null && <><dt className="text-ledger-muted">Diferença</dt><dd className={cn("tabular-nums", t.diferenca_cents < 0 && "text-danger")}>{brlTroca(t.diferenca_cents)}</dd></>}
        {t.finalizado_em && <><dt className="text-ledger-muted">Finalizada por</dt><dd>{t.finalizado_por_nome ?? "—"} · {dataHora(t.finalizado_em)}</dd></>}
        {t.transmissao_em && <><dt className="text-ledger-muted">Transmitida</dt><dd>{t.transmissao_por_nome ?? "—"} · {dataHora(t.transmissao_em)}</dd></>}
        {t.parecer && <><dt className="text-ledger-muted">Parecer</dt><dd>{t.parecer}</dd></>}
      </dl>
      {fotosAbertura.length > 0 && <div><p className="flex items-center gap-1.5 text-sm font-semibold"><Camera className="size-4" aria-hidden /> Fotos da abertura</p><Fotos paths={fotosAbertura} /></div>}

      {gerir && (
        <section className="space-y-3 rounded-2xl border border-line bg-cream-2/60 p-4">
          <h3 className="flex items-center gap-2 font-semibold"><PackageCheck className="size-4" aria-hidden /> Devolutiva para a consultora</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <div><p className="mb-1 text-xs font-semibold text-ledger-muted">Nova situação</p><SmartSelect value={destino} onChange={(v) => setDestino(v as StatusTroca)} options={opcoes.map((s) => ({ value: s, label: STATUS_TROCA[s] }))} /></div>
            <div><p className="mb-1 text-xs font-semibold text-ledger-muted">Solução</p><SmartSelect value={solucao} onChange={(v) => setSolucao(v as SolucaoTroca)} placeholder="Escolher solução" options={Object.entries(SOLUCAO_TROCA).map(([value, label]) => ({ value, label }))} /></div>
          </div>
          {solucao === "troca" && <div><p className="mb-1 text-xs font-semibold text-ledger-muted">Peça que vai no lugar</p><PecaTrocaPicker value={rep} onChange={setRep} /></div>}
          {difPrevista != null && solucao && <p className="text-sm">Diferença da troca: <strong className={cn("tabular-nums", difPrevista < 0 && "text-danger")}>{brlTroca(difPrevista)}</strong>{difPrevista < 0 ? " (peça enviada é mais cara)" : ""}</p>}
          <label htmlFor={`parecer-${t.id}`} className="block text-xs font-semibold text-ledger-muted">Parecer (a consultora lê no app)</label>
          <textarea id={`parecer-${t.id}`} className="admin-input min-h-24 w-full" maxLength={2000} value={parecer} onChange={(e) => setParecer(e.target.value)}
            placeholder={destino === "recusada" ? "Explique por que não foi aprovada" : "Ex.: peça avaliada, banho refeito, segue na próxima maleta"} />
          <Button disabled={mover.isPending || (destino === "recusada" && parecer.trim().length < 5)} onClick={() => mover.mutate()} className="gap-2">
            <Send className="size-4" aria-hidden /> {mover.isPending ? "Registrando…" : `Registrar: ${STATUS_TROCA[destino]}`}
          </Button>
        </section>
      )}
      {gerir && t.consultora_party_id && <TrocaCorreios trocaId={t.id} status={t.status} />}

      <section>
        <h3 className="mb-2 flex items-center gap-2 font-semibold"><MessageSquare className="size-4" aria-hidden /> Conversa e histórico</h3>
        {ev.isLoading && <p className="text-sm text-ledger-muted">Carregando…</p>}
        {ev.isError && <ErrorState message={traduzir(ev.error)} />}
        <ol className="space-y-2.5">
          {t.origem === "legado_smalldata" && (
            <li className="rounded-xl border border-line-soft bg-surface px-3.5 py-2.5 text-sm"><p className="text-xs text-ledger-muted">SmallData · {t.aberto_por_nome ?? "—"} · {dataHora(t.aberto_em)}</p><p>Aberta: {t.motivo}</p>
              {t.finalizado_em && <p className="mt-1">Finalizada por {t.finalizado_por_nome} em {dataHora(t.finalizado_em)}{t.transmissao_em ? ` · transmitida em ${dataHora(t.transmissao_em)}` : ""}</p>}</li>
          )}
          {ev.data?.map((e) => (
            <li key={e.id} className={cn("rounded-xl border px-3.5 py-2.5 text-sm", e.interno ? "border-warning/40 bg-warning/5" : e.autor === "consultora" ? "border-bronze/40 bg-champagne/10" : "border-line-soft bg-surface")}>
              <p className="flex items-center gap-1.5 text-xs text-ledger-muted">{e.interno && <Lock className="size-3" aria-label="Nota interna" />}{e.autor === "consultora" ? "Consultora" : "Lardan"} · {e.autor_nome ?? "—"} · {dataHora(e.created_at)}{e.status ? ` · ${STATUS_TROCA[e.status as StatusTroca] ?? e.status}` : ""}</p>
              {e.texto && <p className="mt-0.5 whitespace-pre-wrap">{e.texto}</p>}
              <Fotos paths={Array.isArray(e.fotos) ? e.fotos : []} />
            </li>
          ))}
        </ol>
        {gerir && <Mensagem trocaId={t.id} />}
      </section>
    </div>
  );
}

function Peca({ titulo, variant, ref_, nome, tam, valor }: { titulo: string; variant: string | null; ref_: string | null; nome: string | null; tam: string | null; valor: number | null }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
      <FotoPeca variantId={variant} alt={nome ?? ""} size="lg" />
      <div className="min-w-0 text-sm">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ledger-muted">{titulo}</p>
        <p className="font-semibold">{ref_ ?? "s/ referência"}</p>
        <p className="line-clamp-2 text-ledger-muted">{nome}</p>
        <p className="tabular-nums">{tam ? `Tam. ${tam} · ` : ""}{brlTroca(valor)}</p>
      </div>
    </div>
  );
}

function Mensagem({ trocaId }: { trocaId: string }) {
  const qc = useQueryClient();
  const [texto, setTexto] = React.useState("");
  const [interno, setInterno] = React.useState(false);
  const [fotos, setFotos] = React.useState<File[]>([]);
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: async () => {
      const paths = await enviarFotosTroca(fotos, chave);
      const { error } = await supabase.rpc("qualidade_troca_mensagem", { _id: trocaId, _texto: texto, _fotos: paths, _interno: interno });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(interno ? "Nota interna salva." : "Mensagem enviada para o app da consultora."); setTexto(""); setFotos([]); setChave(crypto.randomUUID()); void qc.invalidateQueries({ queryKey: ["qualidade"] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  return (
    <div className="mt-3 space-y-2">
      <textarea aria-label="Mensagem" className="admin-input min-h-20 w-full" maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={interno ? "Nota só para a equipe Lardan" : "Mensagem para a consultora"} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="admin-btn cursor-pointer gap-2"><Camera className="size-4" aria-hidden /> {fotos.length ? `${fotos.length} foto(s)` : "Anexar fotos"}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, 6))} /></label>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={interno} onChange={(e) => setInterno(e.target.checked)} /> <Lock className="size-3.5" aria-hidden /> Nota interna (consultora não vê)</label>
        <Button className="ml-auto gap-2" disabled={m.isPending || (texto.trim().length < 2 && fotos.length === 0)} onClick={() => m.mutate()}><Send className="size-4" aria-hidden /> {m.isPending ? "Enviando…" : "Enviar"}</Button>
      </div>
    </div>
  );
}

type ConsultoraBusca = { id: string; codigo: string | null; nome: string; cpf: string | null; status: string };

function NovaTroca({ aberto, onClose, onCriada }: { aberto: boolean; onClose: () => void; onCriada: (id: string) => void }) {
  const qc = useQueryClient();
  const [termoC, setTermoC] = React.useState("");
  const [consultoras, setConsultoras] = React.useState<ConsultoraBusca[]>([]);
  const [buscandoC, setBuscandoC] = React.useState(false);
  const [consultora, setConsultora] = React.useState<ConsultoraBusca | null>(null);
  const [peca, setPeca] = React.useState<PecaBusca | null>(null);
  const [refManual, setRefManual] = React.useState("");
  const [tipo, setTipo] = React.useState<"troca" | "garantia">("troca");
  const [motivo, setMotivo] = React.useState("");
  const [obs, setObs] = React.useState("");
  const [fotos, setFotos] = React.useState<File[]>([]);
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  React.useEffect(() => {
    const t = termoC.trim(); if (t.length < 2) { setConsultoras([]); return; }
    let cancel = false; setBuscandoC(true);
    void supabase.rpc("qualidade_buscar_consultora", { _termo: t }).then(({ data }) => { if (!cancel) { setConsultoras((data ?? []) as unknown as ConsultoraBusca[]); setBuscandoC(false); } });
    return () => { cancel = true; };
  }, [termoC]);
  const limpar = () => { setConsultora(null); setPeca(null); setRefManual(""); setTipo("troca"); setMotivo(""); setObs(""); setFotos([]); setChave(crypto.randomUUID()); };
  const m = useMutation({
    mutationFn: async () => {
      if (!consultora) throw new Error("Escolha a consultora.");
      const paths = await enviarFotosTroca(fotos, chave);
      const { data, error } = await supabase.rpc("qualidade_troca_lancar", {
        _party: consultora.id, _variant: peca?.id ?? null, _referencia: peca ? null : refManual, _nome: null, _tamanho: null, _valor_cents: null,
        _tipo: tipo, _motivo: motivo, _observacao: obs, _fotos: paths, _chave: chave,
      } as never);
      if (error) throw error;
      return data as unknown as { id: string; protocolo: string };
    },
    onSuccess: (r) => { toast.success(`${r.protocolo} lançada. Já aparece no app da consultora.`); void qc.invalidateQueries({ queryKey: ["qualidade"] }); limpar(); onClose(); onCriada(r.id); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const pronto = !!consultora && (!!peca || refManual.trim().length >= 3) && motivo.trim().length >= 3;
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Nova troca</DialogTitle><DialogDescription>Para peças que chegaram no retorno da maleta, por WhatsApp ou no balcão. A consultora vê na hora no app.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div><p className="mb-1 text-sm font-semibold">Consultora</p>
            <SmartSelect value={consultora?.id ?? ""} onChange={(v) => setConsultora(consultoras.find((c) => c.id === v) ?? consultora)} onSearch={setTermoC} loading={buscandoC} searchThreshold={0}
              placeholder="Código, nome ou CPF da consultora" searchPlaceholder="Código, nome ou CPF" emptyLabel={termoC.trim().length < 2 ? "Digite ao menos 2 caracteres." : "Nenhuma consultora encontrada."}
              options={[...(consultora && !consultoras.some((c) => c.id === consultora.id) ? [consultora] : []), ...consultoras].map((c) => ({ value: c.id, label: `[Cód. ${c.codigo ?? "—"}] ${c.nome}`, ...(c.cpf ? { hint: c.cpf } : {}) }))} /></div>
          <div><p className="mb-1 text-sm font-semibold">Peça devolvida</p><PecaTrocaPicker value={peca} onChange={setPeca} />
            {!peca && <input className="admin-input mt-2 h-11 w-full" value={refManual} onChange={(e) => setRefManual(e.target.value.toUpperCase())} placeholder="Ou digite a referência da etiqueta (ex.: LANP0342)" />}</div>
          <div className="flex gap-2">{(["troca", "garantia"] as const).map((x) => <button key={x} type="button" onClick={() => setTipo(x)} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", tipo === x ? "border-bronze bg-bronze text-primary-foreground" : "border-line")}>{x === "troca" ? "Troca" : "Garantia"}</button>)}</div>
          <div><p className="mb-1 text-sm font-semibold">Motivo</p><div className="flex flex-wrap gap-1.5">{MOTIVOS_TROCA.map((x) => <button key={x} type="button" onClick={() => setMotivo(x)} className={cn("rounded-full border px-3 py-1 text-sm", motivo === x ? "border-bronze bg-champagne/30" : "border-line")}>{x}</button>)}</div>
            <input className="admin-input mt-2 h-11 w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" maxLength={200} /></div>
          <textarea className="admin-input min-h-20 w-full" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (ex.: está indo a mesma peça)" maxLength={1000} />
          <label className="admin-btn cursor-pointer gap-2"><Camera className="size-4" aria-hidden /> {fotos.length ? `${fotos.length} foto(s)` : "Fotos da peça (até 6)"}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, 6))} /></label>
          {tipo === "garantia" && fotos.length === 0 && <p className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle className="size-4" aria-hidden /> Recomendado anexar foto em garantia.</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!pronto || m.isPending} onClick={() => m.mutate()} className="gap-2"><Clock3 className="size-4" aria-hidden />{m.isPending ? "Lançando…" : "Lançar troca"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

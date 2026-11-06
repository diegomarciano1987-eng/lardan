/**
 * Captação do representante (0245) — no lugar do quadro de colunas que se arrastava para o lado.
 * Uma lista só, já em ordem de prioridade, e cada candidata com UM botão grande do que fazer agora:
 *  • nova (inclusive a que o Daniel passou do site): "Chamar no WhatsApp" — e já anda para "Conversando";
 *  • conversando: "Próximo: <etapa>";
 *  • aprovada pela Lardan: "Fazer abertura" e, ali mesmo, contrato e promissória;
 *  • com maleta: contrato e promissória;
 *  • não aprovada: só o contato.
 * A candidata que a Lardan aprovou deixa de ficar "travada": ela vira a próxima tarefa do representante.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Copy, MessageCircle, PackageOpen, Phone, Plus, Sparkles } from "lucide-react";
import { AtendimentoPresencial, DevolverLead } from "@/components/representante/AtendimentoPresencial";
import { repCpfDefinir, repCrm, repCrmMover, repEtapaNova, type RepCrm } from "@/lib/representante";
import { NovaCandidata, wa } from "@/components/representante/AcoesRepresentante";
import { AssinaturaDigital } from "@/components/representante/AssinaturaDigital";

type Card = RepCrm["cards"][number];
type Passo = "chamar" | "conversando" | "abrir" | "maleta" | "fora";
const FILTROS: { id: "agora" | Passo | "todas"; rotulo: string }[] = [
  { id: "agora", rotulo: "Fazer agora" }, { id: "conversando", rotulo: "Conversando" },
  { id: "maleta", rotulo: "Com maleta" }, { id: "fora", rotulo: "Não aprovadas" }, { id: "todas", rotulo: "Todas" },
];
const ORIGEM: Record<string, string> = {
  encaminhada: "O Daniel passou para você (site)", rota: "Site · cidade da sua rota", link: "Veio pelo seu link", manual: "Você cadastrou", madrinha: "Indicação de consultora",
};
const STATUS: Record<string, string> = {
  novo: "Aguardando a Lardan", em_analise: "Em análise na Lardan", qualificado: "Qualificada", aprovado: "Aprovada pela Lardan", recusado: "Não aprovada",
};
const dias = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);
const primeiro = (n: string) => { const p = (n.split(" ")[0] ?? "").toLowerCase(); return p.charAt(0).toUpperCase() + p.slice(1); };

function roteiro(c: Card) {
  const n = primeiro(c.nome);
  if (c.origem === "encaminhada" || c.origem === "rota" || !c.origem)
    return `Olá, ${n}! Tudo bem? Sou representante da Lardan Semijoias na sua região. Recebi o seu cadastro para ser consultora Lardan. Podemos conversar hoje para eu te explicar como funciona a maleta?`;
  return `Olá, ${n}! Aqui é da Lardan Semijoias. Vamos dar o próximo passo da sua entrada como consultora? Quando posso te ligar?`;
}

export function CaptacaoInteligente({ rep, onAbertura }: { rep: string; onAbertura: () => void }) {
  const q = useQuery({ queryKey: ["rep", rep, "crm"], queryFn: () => repCrm(rep) });
  const qc = useQueryClient();
  const [filtro, setFiltro] = React.useState<(typeof FILTROS)[number]["id"]>("agora");
  const [aberto, setAberto] = React.useState<string | null>(null);
  const recarregar = () => void qc.invalidateQueries({ queryKey: ["rep", rep, "crm"] });
  const mover = useMutation({
    mutationFn: (a: { lead: string; etapa: string; aviso?: string }) => repCrmMover(a.lead, a.etapa).then(() => a.aviso),
    onSuccess: (aviso) => { if (aviso) toast.success(aviso); recarregar(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.error) return <p className="text-sm text-destructive">{(q.error as Error).message}</p>;
  if (!q.data) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  const d = q.data;
  const livres = d.etapas.filter((e) => !e.sistema);
  const etapaDe = (c: Card) => d.etapas.find((e) => e.id === c.etapa_id);
  const passo = (c: Card): Passo => {
    const s = c.sistema ?? etapaDe(c)?.sistema ?? null;
    if (s === "aprovada") return "abrir";
    if (s === "primeira_maleta") return "maleta";
    if (s === "nao_aprovada") return "fora";
    return livres[0] && c.etapa_id === livres[0].id ? "chamar" : "conversando";
  };
  const ordem: Record<Passo, number> = { abrir: 0, chamar: 1, conversando: 2, maleta: 3, fora: 4 };
  const cards = [...d.cards].sort((a, b) => ordem[passo(a)] - ordem[passo(b)] || new Date(a.criado).getTime() - new Date(b.criado).getTime());
  const conta = (id: (typeof FILTROS)[number]["id"]) =>
    id === "todas" ? cards.length : id === "agora" ? cards.filter((c) => ["abrir", "chamar"].includes(passo(c))).length : cards.filter((c) => passo(c) === id).length;
  const visiveis = cards.filter((c) => filtro === "todas" || (filtro === "agora" ? ["abrir", "chamar"].includes(passo(c)) : passo(c) === filtro));
  const link = d.codigo ? `https://www.lardan.com.br/seja-lardan?rep=${d.codigo}` : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Candidatas</h2>
        <NovaCandidata rep={rep} />
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-sm ${filtro === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>
            {f.rotulo} <span className="ml-1 tabular-nums opacity-80">{conta(f.id)}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {filtro === "agora" ? "Nada para fazer agora. Use seu link abaixo para trazer novas candidatas." : "Ninguém aqui."}
        </p>
      )}

      <ul className="space-y-3">
        {visiveis.map((c) => {
          const p = passo(c);
          const idx = livres.findIndex((x) => x.id === c.etapa_id);
          const proxima = idx >= 0 ? livres[idx + 1] : undefined;
          const semContato = p === "chamar" ? dias(c.criado) : 0;
          return (
            <li key={c.lead_id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">{c.cidade}</p>
                </div>
                <a href={`tel:${(c.whatsapp ?? "").replace(/\D/g, "")}`} className="grid size-10 shrink-0 place-items-center rounded-full border border-border" aria-label="Ligar"><Phone className="size-4" /></a>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[0.72rem]">
                <span className="rounded-full bg-muted px-2 py-0.5">{ORIGEM[c.origem ?? ""] ?? ORIGEM["encaminhada"]}</span>
                <span className="rounded-full bg-muted px-2 py-0.5">{STATUS[c.status_lardan] ?? c.status_lardan}</span>
                {p === "conversando" && <span className="rounded-full bg-muted px-2 py-0.5">{etapaDe(c)?.nome}</span>}
                {semContato >= 2 && <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">Sem contato há {semContato} dias</span>}
              </div>
              {c.nota && <p className="mt-2 text-xs">{c.nota}</p>}
              {p !== "fora" && p !== "maleta" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <AtendimentoPresencial rep={rep} card={c} onFeito={recarregar} />
                  <DevolverLead rep={rep} card={c} onFeito={recarregar} />
                </div>
              )}

              <div className="mt-3 space-y-2">
                {p === "chamar" && (
                  <a href={wa(c.whatsapp, roteiro(c))} target="_blank" rel="noreferrer"
                    onClick={() => livres[1] && mover.mutate({ lead: c.lead_id, etapa: livres[1].id, aviso: `${primeiro(c.nome)} foi para "${livres[1].nome}".` })}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                    <MessageCircle className="size-5" /> Chamar no WhatsApp
                  </a>
                )}
                {p === "conversando" && (
                  <div className="flex gap-2">
                    <a href={wa(c.whatsapp, `Olá, ${primeiro(c.nome)}! `)} target="_blank" rel="noreferrer" className="grid size-12 shrink-0 place-items-center rounded-xl border border-border" aria-label="WhatsApp"><MessageCircle className="size-5" /></a>
                    {proxima ? (
                      <button type="button" disabled={mover.isPending} onClick={() => mover.mutate({ lead: c.lead_id, etapa: proxima.id })}
                        className="h-12 flex-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                        Próximo: {proxima.nome}
                      </button>
                    ) : (
                      <p className="flex h-12 flex-1 items-center justify-center rounded-xl bg-muted px-3 text-center text-xs text-muted-foreground">Aguardando a decisão da Lardan</p>
                    )}
                  </div>
                )}
                {p === "abrir" && (
                  <button type="button" onClick={onAbertura}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
                    <PackageOpen className="size-5" /> Aprovada! Fazer a abertura
                  </button>
                )}
                {(p === "abrir" || p === "maleta") && (
                  c.party_id ? (
                    <button type="button" onClick={() => setAberto(aberto === c.lead_id ? null : c.lead_id)}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-medium">
                      Contrato e promissória <ChevronDown className={`size-4 transition-transform ${aberto === c.lead_id ? "rotate-180" : ""}`} />
                    </button>
                  ) : <p className="text-xs text-muted-foreground">O contrato aparece aqui assim que a Lardan concluir o cadastro dela.</p>
                )}
                {p === "fora" && (
                  <a href={wa(c.whatsapp, `Olá, ${primeiro(c.nome)}! `)} target="_blank" rel="noreferrer"
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm"><MessageCircle className="size-4" /> WhatsApp</a>
                )}
                {p === "conversando" && livres.length > 2 && (
                  <select aria-label="Mudar etapa" value={c.etapa_id} onChange={(e) => mover.mutate({ lead: c.lead_id, etapa: e.target.value })}
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-muted-foreground">
                    {livres.map((e) => <option key={e.id} value={e.id}>Etapa: {e.nome}</option>)}
                  </select>
                )}
              </div>
              {aberto === c.lead_id && c.party_id && (
                <div className="mt-3 space-y-3">
                  <CpfRapido rep={rep} party={c.party_id} temNaCandidatura={!!c.tem_cpf} />
                  <AssinaturaDigital party={c.party_id} rep={rep} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> Seu link Seja Lardan</summary>
        <p className="mt-2 text-sm text-muted-foreground">Quem se cadastrar por ele chega para a Lardan já ligada a você.</p>
        {link && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2.5 text-sm">{link}</code>
            <button type="button" className="admin-btn" onClick={() => { void navigator.clipboard.writeText(link); toast.success("Link copiado."); }}><Copy className="size-4" /> Copiar</button>
            <a className="admin-btn" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`Quer ser Consultora Lardan? Faça seu cadastro: ${link}`)}`}><MessageCircle className="size-4" /> WhatsApp</a>
          </div>
        )}
      </details>
      <EtapasProprias rep={rep} etapas={livres} onFeito={recarregar} />
    </div>
  );
}

/** CPF que falta para o contrato: usa o da candidatura ou o que o representante digitar. */
function CpfRapido({ rep, party, temNaCandidatura }: { rep: string; party: string; temNaCandidatura: boolean }) {
  const [cpf, setCpf] = React.useState("");
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: (v: string | null) => repCpfDefinir(rep, party, v),
    onSuccess: (r) => { toast.success(r.ja_tinha ? "Ela já tem CPF no cadastro." : "CPF salvo."); setCpf(""); void qc.invalidateQueries({ queryKey: ["assinaturas", party] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mascara = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); };
  return (
    <details className="rounded-xl bg-muted/50 p-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">Faltou o CPF dela para o contrato?</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {temNaCandidatura && (
          <button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate(null)} className="h-10 rounded-lg border border-border px-3 text-xs">Usar o CPF da candidatura</button>
        )}
        <input inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascara(e.target.value))} placeholder="000.000.000-00"
          className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3" />
        <button type="button" disabled={cpf.replace(/\D/g, "").length !== 11 || salvar.isPending} onClick={() => salvar.mutate(cpf)}
          className="h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">Salvar CPF</button>
      </div>
    </details>
  );
}

function EtapasProprias({ rep, etapas, onFeito }: { rep: string; etapas: { id: string; nome: string }[]; onFeito: () => void }) {
  const [nome, setNome] = React.useState("");
  const nova = useMutation({
    mutationFn: () => repEtapaNova(rep, nome),
    onSuccess: () => { setNome(""); onFeito(); toast.success("Etapa criada."); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <details className="rounded-2xl border border-border bg-card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Suas etapas</summary>
      <p className="mt-2 text-xs text-muted-foreground">{etapas.map((e) => e.nome).join(" → ")}</p>
      <div className="mt-3 flex gap-2">
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Retornar sábado" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 outline-none" />
        <button type="button" disabled={!nome.trim() || nova.isPending} onClick={() => nova.mutate()} className="flex h-10 items-center gap-1 rounded-xl bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50"><Plus className="size-4" /> Adicionar</button>
      </div>
    </details>
  );
}

/** Abertura: as novas consultoras do representante com contrato e promissória, sempre à mão (não só logo depois do vínculo). */
export function DocumentosNovasConsultoras({ rep }: { rep: string }) {
  const q = useQuery({ queryKey: ["rep", rep, "crm"], queryFn: () => repCrm(rep) });
  const [aberto, setAberto] = React.useState<string | null>(null);
  const novas = (q.data?.cards ?? []).filter((c) => c.party_id && (c.sistema === "aprovada" || c.sistema === "primeira_maleta"));
  if (!novas.length) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Contrato e promissória das novas consultoras</h3>
      <ul className="space-y-2">
        {novas.map((c) => (
          <li key={c.lead_id} className="rounded-2xl border border-border bg-card p-3">
            <button type="button" onClick={() => setAberto(aberto === c.lead_id ? null : c.lead_id)} className="flex w-full items-center justify-between gap-2 text-left text-sm">
              <span><strong>{c.nome}</strong> <span className="text-xs text-muted-foreground">· {c.sistema === "primeira_maleta" ? "com maleta" : "aprovada"}</span></span>
              <ChevronDown className={`size-4 transition-transform ${aberto === c.lead_id ? "rotate-180" : ""}`} />
            </button>
            {aberto === c.lead_id && (
              <div className="mt-3 space-y-3">
                <CpfRapido rep={rep} party={c.party_id!} temNaCandidatura={!!c.tem_cpf} />
                <AssinaturaDigital party={c.party_id!} rep={rep} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

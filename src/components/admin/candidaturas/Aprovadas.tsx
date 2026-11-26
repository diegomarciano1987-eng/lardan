/**
 * 0398 — Captação: aprovadas sem maleta e os documentos delas.
 * Aprovadas (vista da Captação): o Daniel escolhe, para a candidata do site, Correios (a Lardan monta e manda)
 * ou um representante (ela passa para a carteira dele). Candidata de representante volta para ele, sem escolha.
 * DocumentosCandidata (ficha): os 4 itens com foto, conferir ou pedir de novo, e o link para mandar para ela.
 * Nada é enviado sozinho: o WhatsApp abre com a mensagem pronta para a pessoa conferir e enviar.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle, PackageCheck, Truck, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { linkWhatsapp } from "@/lib/crm/api";
import { documentosDaCandidata, type DocumentoEquipe, type DocumentosEquipe } from "@/lib/captacao/documentos.functions";
import { ITENS_DOCUMENTO, ExemploDocumento } from "@/components/captacao/DocumentosAprovada";
import { cn } from "@/lib/utils";

type Aprovada = {
  id: string; nome: string; cidade: string; uf: string; whatsapp: string; protocolo: string; canal: "site" | "representante";
  aprovada_em: string; automatica: boolean; representante: { id: string; nome: string } | null; representante_origem: string | null;
  docs: { token: string | null; finalizado_em: string | null; enviados: number; conferidos: number; refazer: number };
  envio: { modo: "correios" | "representante"; nota: string | null; em: string; representante: string | null } | null;
};
type Rep = { id: string; nome: string; whatsapp: string | null };

const dataBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
export const linkDocumentos = (token: string) => `${window.location.origin}/documentos/${token}`;
export const mensagemDocumentos = (nome: string, token: string) =>
  `Oi, ${nome.split(" ")[0]}! Aqui é da Lardan Semijoias. Seu cadastro foi aprovado! Para seguir com a sua maleta, ` +
  `envie por este link 4 fotos: documento com foto, comprovante de residência, uma selfie com o documento e a frente da sua casa. ` +
  `Leva uns 5 minutos: ${linkDocumentos(token)}`;

async function rpc<T>(f: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(f as never, a as never);
  if (error) throw new Error(error.message.includes("sem_permissao") ? "Sem permissão." : error.message);
  return data as T;
}

function Docs({ d }: { d: Aprovada["docs"] }) {
  if (d.refazer) return <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-danger">{d.refazer} para refazer</span>;
  if (d.finalizado_em) return <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold", d.conferidos === 4 ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>{d.conferidos === 4 ? "Conferidos" : `Enviados · ${d.conferidos}/4 conferidos`}</span>;
  return <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-ledger-muted">{d.enviados}/4 enviados</span>;
}

export function Aprovadas({ canal, podeEscolher }: { canal: "site" | "representante"; podeEscolher: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["crm", "aprovadas", canal], queryFn: () => rpc<Aprovada[]>("captacao_aprovadas", { _canal: canal }) });
  const reps = useQuery({ queryKey: ["crm", "captacao-reps"], enabled: podeEscolher && canal === "site", staleTime: 300_000,
    queryFn: () => rpc<Rep[]>("captacao_representantes", {}) });
  const definir = useMutation({
    mutationFn: (a: { lead: string; modo: "correios" | "representante"; rep?: string | null | undefined }) =>
      rpc<{ modo: string; representante: string | null }>("captacao_envio_definir", { _lead: a.lead, _modo: a.modo, _rep: a.rep ?? null, _nota: null }),
    onSuccess: (r) => { toast.success(r.modo === "correios" ? "Correios: a Lardan monta e envia." : `Encaminhada para ${r.representante}.`); void qc.invalidateQueries({ queryKey: ["crm", "aprovadas"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-[360px] w-full" />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const itens = q.data ?? [];
  return (
    <Panel title={`Aprovadas sem maleta · ${itens.length}`} flush>
      <p className="border-b border-line px-5 py-3 text-xs text-ledger-muted">
        {canal === "site"
          ? "Mande o link dos documentos, confira na ficha e escolha como a maleta vai: Correios (a Lardan monta e envia) ou um representante (ela passa para a carteira dele)."
          : "Candidatas de representante voltam para ele: o app dele libera a maleta assim que ela é aprovada."}
      </p>
      {itens.length === 0 ? (
        <div className="px-5"><EmptyState title="Nenhuma aprovada esperando maleta." description="Quando alguém for aprovada (sozinha ou pelo Daniel), ela aparece aqui." /></div>
      ) : (
        <ul className="divide-y divide-line-soft">
          {itens.map((a) => (
            <li key={a.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.4fr_1fr_1.6fr] lg:items-center">
              <div className="min-w-0">
                <Link to="/admin/candidaturas/$id" params={{ id: a.id }} className="font-semibold text-ledger-text hover:text-bronze">{a.nome}</Link>
                <p className="text-xs text-ledger-muted">{a.cidade}/{a.uf} · aprovada {a.automatica ? "automaticamente" : "pela equipe"} em {dataBR(a.aprovada_em)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Docs d={a.docs} />
                {a.docs.token ? (
                  <>
                    <a href={linkWhatsapp(a.whatsapp, mensagemDocumentos(a.nome, a.docs.token))} target="_blank" rel="noopener noreferrer" className="admin-btn inline-flex items-center gap-1.5" title="Abre o WhatsApp com a mensagem pronta">
                      <MessageCircle aria-hidden className="size-4" /> Link
                    </a>
                    <button type="button" className="admin-btn inline-flex items-center gap-1.5" onClick={() => void navigator.clipboard.writeText(linkDocumentos(a.docs.token!)).then(() => toast.success("Link copiado."))}>
                      <Copy aria-hidden className="size-4" /> Copiar
                    </button>
                  </>
                ) : (
                  <Link to="/admin/candidaturas/$id" params={{ id: a.id }} className="text-xs font-semibold text-bronze">Gerar link na ficha</Link>
                )}
              </div>
              <div>
                {a.canal === "representante" ? (
                  <p className="inline-flex items-center gap-1.5 text-sm"><UserRound aria-hidden className="size-4" /> Com o representante {a.representante?.nome ?? ""}</p>
                ) : (
                  <Envio a={a} reps={reps.data ?? []} pode={podeEscolher} ocupado={definir.isPending}
                    onDefinir={(modo, rep) => definir.mutate({ lead: a.id, modo, rep })} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Envio({ a, reps, pode, ocupado, onDefinir }: {
  a: Aprovada; reps: Rep[]; pode: boolean; ocupado: boolean; onDefinir: (modo: "correios" | "representante", rep?: string) => void;
}) {
  const [rep, setRep] = React.useState(a.envio?.modo === "representante" ? a.representante?.id ?? "" : "");
  const atual = a.envio
    ? a.envio.modo === "correios" ? "Correios: a Lardan monta e envia" : `Representante: ${a.envio.representante ?? ""}`
    : null;
  if (!pode) return <p className="text-sm text-ledger-muted">{atual ?? "Aguardando a escolha do Daniel."}</p>;
  const escolhido = reps.find((r) => r.id === rep);
  return (
    <div className="space-y-2">
      {atual && <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success"><PackageCheck aria-hidden className="size-4" /> {atual}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={ocupado || a.envio?.modo === "correios"} onClick={() => onDefinir("correios")}
          className={cn("admin-btn inline-flex items-center gap-1.5", a.envio?.modo === "correios" && "bg-champagne-soft text-bronze")}>
          <Truck aria-hidden className="size-4" /> Correios
        </button>
        <div className="min-w-[12rem] flex-1">
          <SmartSelect value={rep} onChange={setRep} placeholder="Representante…" options={reps.map((r) => ({ value: r.id, label: r.nome }))} />
        </div>
        <button type="button" disabled={ocupado || !rep || (a.envio?.modo === "representante" && a.representante?.id === rep)} onClick={() => onDefinir("representante", rep)} className="admin-btn">
          Encaminhar
        </button>
      </div>
      {a.envio?.modo === "representante" && escolhido?.whatsapp && (
        <a href={linkWhatsapp(escolhido.whatsapp, `Olá, ${escolhido.nome.split(" ")[0]}! A Lardan aprovou ${a.nome} (${a.cidade}/${a.uf}) e ela está na sua carteira no app para a abertura da maleta.`)}
          target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-bronze">
          <MessageCircle aria-hidden className="size-3.5" /> Avisar o representante no WhatsApp
        </a>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ficha
export function DocumentosCandidata({ leadId, nome, whatsapp, podeEditar }: { leadId: string; nome: string; whatsapp: string | null; podeEditar: boolean }) {
  const qc = useQueryClient();
  const ver = useServerFn(documentosDaCandidata);
  const chave = ["crm", "documentos", leadId];
  const q = useQuery({ queryKey: chave, queryFn: () => ver({ data: { lead: leadId } }), staleTime: 240_000 });
  const gerar = useMutation({
    mutationFn: () => rpc<string>("candidatura_documentos_link_gerar", { _lead: leadId }),
    onSuccess: () => { toast.success("Link pronto."); void qc.invalidateQueries({ queryKey: chave }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const conferir = useMutation({
    mutationFn: (a: { doc: string; ok: boolean; motivo?: string | undefined }) => rpc("candidatura_documento_conferir", { _doc: a.doc, _ok: a.ok, _motivo: a.motivo ?? null }),
    onSuccess: (_d, a) => { toast.success(a.ok ? "Conferido." : "Pedido de novo: o link volta a valer para ela."); void qc.invalidateQueries({ queryKey: chave }); void qc.invalidateQueries({ queryKey: ["crm", "aprovadas"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  const d = q.data as DocumentosEquipe;
  if (!d.aprovada && !d.link) return null;
  const por = new Map(d.itens.map((i) => [i.tipo, i]));
  const token = d.link && !d.link.vencido ? d.link.token : null;
  return (
    <Panel title="Documentos da aprovada">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {d.link?.finalizado_em ? <span className="text-success">Enviados por ela em {new Date(d.link.finalizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.</span>
            : <span className="text-ledger-muted">{d.itens.length ? `${d.itens.filter((i) => i.situacao !== "refazer").length} de 4 enviados, ainda sem terminar.` : "Ela ainda não enviou nada."}</span>}
          {token && whatsapp && (
            <a href={linkWhatsapp(whatsapp, mensagemDocumentos(nome, token))} target="_blank" rel="noopener noreferrer" className="admin-btn inline-flex items-center gap-1.5">
              <MessageCircle aria-hidden className="size-4" /> Mandar o link
            </a>
          )}
          {token && (
            <button type="button" className="admin-btn inline-flex items-center gap-1.5" onClick={() => void navigator.clipboard.writeText(linkDocumentos(token)).then(() => toast.success("Link copiado."))}>
              <Copy aria-hidden className="size-4" /> Copiar link
            </button>
          )}
          {podeEditar && d.aprovada && (!d.link || d.link.vencido) && (
            <button type="button" disabled={gerar.isPending} onClick={() => gerar.mutate()} className="admin-btn">{d.link ? "Renovar link vencido" : "Gerar link dos documentos"}</button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {ITENS_DOCUMENTO.map((it) => (
            <ItemEquipe key={it.tipo} titulo={it.titulo} tipo={it.tipo} doc={por.get(it.tipo) ?? null} podeEditar={podeEditar} ocupado={conferir.isPending}
              onConferir={(ok, motivo) => { const doc = por.get(it.tipo); if (doc) conferir.mutate({ doc: doc.id, ok, motivo }); }} />
          ))}
        </div>
        <p className="text-xs text-ledger-muted">As fotos abrem por link temporário (10 minutos). Elas têm dado pessoal: não baixe nem encaminhe fora da Lardan.</p>
      </div>
    </Panel>
  );
}

function ItemEquipe({ titulo, tipo, doc, podeEditar, ocupado, onConferir }: {
  titulo: string; tipo: DocumentoEquipe["tipo"]; doc: DocumentoEquipe | null; podeEditar: boolean; ocupado: boolean; onConferir: (ok: boolean, motivo?: string) => void;
}) {
  const [pedindo, setPedindo] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const imagem = doc?.url && doc.mime.startsWith("image/") && !/hei[cf]/.test(doc.mime);
  return (
    <div className={cn("rounded-xl border p-3", doc?.situacao === "refazer" ? "border-danger/50" : doc?.situacao === "conferido" ? "border-success/50" : "border-line")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{titulo}</p>
        <span className="text-[0.6875rem] font-semibold text-ledger-muted">
          {!doc ? "Falta" : doc.situacao === "conferido" ? "Conferido" : doc.situacao === "refazer" ? "Pedido de novo" : "Para conferir"}
        </span>
      </div>
      <div className="mt-2 overflow-hidden rounded-lg bg-surface-muted text-ledger-muted">
        {imagem ? (
          <a href={doc!.url!} target="_blank" rel="noopener noreferrer"><img src={doc!.url!} alt={titulo} className="aspect-[4/3] w-full object-cover" loading="lazy" /></a>
        ) : doc?.url ? (
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="flex aspect-[4/3] items-center justify-center gap-1.5 text-sm font-semibold text-bronze"><ExternalLink aria-hidden className="size-4" /> Abrir arquivo</a>
        ) : (
          <ExemploDocumento tipo={tipo} className="mx-auto aspect-[4/3] w-2/3 opacity-40" />
        )}
      </div>
      {doc?.situacao === "refazer" && doc.motivo && <p className="mt-2 text-xs text-danger">{doc.motivo}</p>}
      {podeEditar && doc && doc.situacao === "enviado" && !pedindo && (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={ocupado} onClick={() => onConferir(true)} className="admin-btn flex-1">Conferido</button>
          <button type="button" disabled={ocupado} onClick={() => setPedindo(true)} className="admin-btn flex-1">Pedir de novo</button>
        </div>
      )}
      {pedindo && (
        <div className="mt-2 space-y-2">
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300} placeholder="O que ela precisa refazer (ela vê esta frase)"
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={ocupado || motivo.trim().length < 5} onClick={() => { onConferir(false, motivo.trim()); setPedindo(false); setMotivo(""); }} className="admin-btn flex-1">Pedir de novo</button>
            <button type="button" onClick={() => setPedindo(false)} className="admin-btn flex-1">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

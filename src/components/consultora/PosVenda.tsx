import * as React from "react";
import { compactarFoto } from "@/lib/foto-compacta";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ChevronRight, MessageCircle, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { FotoPeca } from "@/components/FotoPeca";
import { PecaTrocaPicker } from "@/components/qualidade/PecaTrocaPicker";
import { supabase } from "@/integrations/supabase/client";
import { detalhePedido, traduzir } from "@/lib/maletas";
import { cn } from "@/lib/utils";
import {
  STATUS_TROCA_CONSULTORA, SOLUCAO_TROCA, MOTIVOS_TROCA, protocoloTroca, brlTroca, eventosTroca, enviarFotosTroca, urlsFotosTroca, dataHora,
  type Troca, type PecaBusca,
} from "@/lib/qualidade-trocas";

const CHAVE_LISTA = ["consultora", "qualidade-trocas"] as const;

/** Botão no pedido pago: abre a troca já com as peças daquele pedido. */
export function AbrirPosVenda({ pedido }: { pedido: string }) {
  const [aberto, setAberto] = React.useState(false);
  return <><Button variant="outline" className="h-auto min-h-12" onClick={() => setAberto(true)}>Troca ou garantia</Button>
    <Dialog open={aberto} onOpenChange={setAberto}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Troca ou garantia</DialogTitle><DialogDescription>Vai direto para a Qualidade da Lardan.</DialogDescription></DialogHeader>{aberto && <FormularioTroca pedido={pedido} onFim={() => setAberto(false)} />}</DialogContent></Dialog></>;
}

function FormularioTroca({ pedido, onFim }: { pedido?: string; onFim: () => void }) {
  const qc = useQueryClient();
  const ped = useQuery({ queryKey: ["consultora", "pedido", pedido], enabled: !!pedido, queryFn: () => detalhePedido(pedido ?? "") });
  const [peca, setPeca] = React.useState<PecaBusca | null>(null);
  const [itemPedido, setItemPedido] = React.useState("");
  const [refManual, setRefManual] = React.useState("");
  const [tipo, setTipo] = React.useState<"troca" | "garantia">("troca");
  const [motivo, setMotivo] = React.useState("");
  const [obs, setObs] = React.useState("");
  const [fotos, setFotos] = React.useState<File[]>([]);
  const [chave] = React.useState(() => crypto.randomUUID());
  const [protocolo, setProtocolo] = React.useState("");
  const variantPedido = ped.data?.itens.find((i) => i.id === itemPedido)?.variant_id;
  const m = useMutation({
    mutationFn: async () => {
      const paths = await enviarFotosTroca(fotos, chave);
      const { data, error } = await supabase.rpc("qualidade_troca_abrir", {
        _variant: (variantPedido ?? peca?.id ?? null) as unknown as string, _referencia: refManual, _tamanho: "", _tipo: tipo, _motivo: motivo, _observacao: obs, _fotos: paths, _chave: chave,
      });
      if (error) throw error;
      return data as unknown as { protocolo: string };
    },
    onSuccess: (r) => { setProtocolo(r.protocolo); void qc.invalidateQueries({ queryKey: CHAVE_LISTA }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  if (protocolo) return <div role="status" className="py-6 text-center"><h3 className="text-2xl font-semibold">Enviado para a Qualidade</h3><p className="mt-3 text-xl font-bold">{protocolo}</p><p className="mt-3 text-muted-foreground">Acompanhe em Mais → Trocas e garantias. A resposta da Lardan aparece lá.</p><Button className="mt-5 min-h-12 w-full" onClick={onFim}>Fechar</Button></div>;
  const temPeca = !!variantPedido || !!peca || refManual.trim().length >= 3;
  const pronto = temPeca && motivo.trim().length >= 3 && (tipo === "troca" || fotos.length > 0);
  return (
    <div className="space-y-5 text-[1.02rem]">
      <div><p className="mb-2 font-semibold">1. Qual peça?</p>
        {pedido ? <SmartSelect value={itemPedido} onChange={setItemPedido} placeholder={ped.isLoading ? "Carregando peças…" : "Escolha a peça do pedido"} options={(ped.data?.itens ?? []).map((i) => ({ value: i.id, label: `${i.quantity}× ${i.product_name}` }))} />
          : <><PecaTrocaPicker value={peca} onChange={setPeca} placeholder="Busque pela referência da etiqueta ou nome" />
            {!peca && <input className="admin-input mt-2 min-h-12 w-full" value={refManual} onChange={(e) => setRefManual(e.target.value.toUpperCase())} placeholder="Ou digite a referência (ex.: LANP0342)" aria-label="Referência da etiqueta" />}</>}
      </div>
      <div><p className="mb-2 font-semibold">2. Troca ou garantia?</p><div className="grid grid-cols-2 gap-3">{(["troca", "garantia"] as const).map((t) => <Button key={t} type="button" className="min-h-12" variant={tipo === t ? "default" : "outline"} onClick={() => setTipo(t)}>{t === "troca" ? "Troca" : "Garantia"}</Button>)}</div></div>
      <div><p className="mb-2 font-semibold">3. O que aconteceu?</p><div className="flex flex-wrap gap-2">{MOTIVOS_TROCA.map((x) => <button key={x} type="button" onClick={() => setMotivo(x)} className={cn("min-h-11 rounded-full border px-4 text-[0.98rem]", motivo === x ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{x}</button>)}</div>
        <textarea className="admin-input mt-3 min-h-20 w-full" value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} placeholder="Conte o detalhe (opcional)" aria-label="Observação" /></div>
      <div><p className="mb-2 font-semibold">4. Fotos {tipo === "garantia" ? "(obrigatória na garantia)" : "(opcional)"}</p>
        <label className="admin-btn min-h-12 w-full cursor-pointer justify-center gap-2"><Camera className="size-5" aria-hidden /> {fotos.length ? `${fotos.length} foto(s) escolhida(s)` : "Tirar ou escolher fotos (até 3)"}
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" onChange={async (e) => { const brutas = Array.from(e.target.files ?? []); if (brutas.length > 3) { toast.error("Envie até três fotos."); return; } const fs = await Promise.all(brutas.map((f) => compactarFoto(f))); if (fs.some((f) => f.size > 5 * 1024 * 1024)) { toast.error("Foto grande demais: tire de novo com menos zoom."); return; } setFotos(fs); }} /></label></div>
      <Button className="min-h-13 w-full text-base" disabled={!pronto || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Enviando…" : "Enviar para a Qualidade"}</Button>
      <p className="text-center text-sm text-muted-foreground">Nenhum valor ou estoque muda sozinho: a Qualidade da Lardan analisa e responde aqui.</p>
    </div>
  );
}

/** Lista de trocas da consultora (abertas por ela no app ou pela Lardan) com conversa e devolutiva. */
export function ListaPosVenda() {
  const q = useQuery({
    queryKey: CHAVE_LISTA,
    queryFn: async () => {
      const { data, error } = await supabase.from("qualidade_trocas")
        .select("id,protocolo,legado_id,origem,tipo,status,motivo,observacao,dev_variant_id,dev_referencia,dev_nome,dev_tamanho,dev_valor_cents,solucao,rep_variant_id,rep_referencia,rep_nome,rep_tamanho,rep_valor_cents,diferenca_cents,parecer,fotos,aberto_em,finalizado_em,transmissao_em,novidade_consultora")
        .order("novidade_consultora", { ascending: false }).order("aberto_em", { ascending: false }).limit(200);
      if (error) throw error;
      return data as unknown as Troca[];
    },
  });
  const [nova, setNova] = React.useState(false);
  const [aberta, setAberta] = React.useState<Troca | null>(null);
  const [filtro, setFiltro] = React.useState<"andamento" | "finalizadas">("andamento");
  const lista = (q.data ?? []).filter((t) => (filtro === "andamento" ? !["resolvida", "recusada"].includes(t.status) : ["resolvida", "recusada"].includes(t.status)));
  const novidades = (q.data ?? []).filter((t) => t.novidade_consultora).length;
  return (
    <section id="trocas-garantias" className="border-t border-border py-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Trocas e garantias {novidades > 0 && <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-sm text-destructive-foreground">{novidades} nova(s)</span>}</h2>
        <Button className="min-h-11 gap-1.5" onClick={() => setNova(true)}><Plus className="size-4" aria-hidden /> Nova</Button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">{(["andamento", "finalizadas"] as const).map((f) => <Button key={f} variant={filtro === f ? "default" : "outline"} className="min-h-11" onClick={() => setFiltro(f)}>{f === "andamento" ? "Em andamento" : "Finalizadas"}</Button>)}</div>
      {q.isLoading && <p>Carregando…</p>}
      {q.isError && <p role="alert">Não foi possível carregar as trocas.</p>}
      {q.data && lista.length === 0 && <p className="text-muted-foreground">{filtro === "andamento" ? "Nenhuma troca em andamento." : "Nenhuma troca finalizada."}</p>}
      <ul className="space-y-2">
        {lista.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setAberta(t)} className={cn("flex w-full items-center gap-3 rounded-2xl border bg-card p-3.5 text-left", t.novidade_consultora ? "border-destructive" : "border-border")}>
              <FotoPeca variantId={t.dev_variant_id} alt={t.dev_nome ?? ""} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{protocoloTroca(t.protocolo)} · {t.dev_referencia ?? "peça"}</span>
                <span className="block truncate text-[0.95rem] text-muted-foreground">{t.dev_nome}</span>
                <span className={cn("block text-[0.95rem] font-medium", t.status === "recusada" ? "text-destructive" : t.status === "resolvida" ? "text-success" : "text-primary")}>{STATUS_TROCA_CONSULTORA[t.status]}</span>
              </span>
              {t.novidade_consultora && <span className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">Nova resposta</span>}
              <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={nova} onOpenChange={setNova}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Nova troca ou garantia</DialogTitle><DialogDescription>Peça da maleta ou de uma venda. Vai direto para a Qualidade da Lardan.</DialogDescription></DialogHeader>{nova && <FormularioTroca onFim={() => setNova(false)} />}</DialogContent></Dialog>
      <Dialog open={!!aberta} onOpenChange={(o) => { if (!o) setAberta(null); }}><DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">{aberta && <DetalheConsultora t={aberta} />}</DialogContent></Dialog>
    </section>
  );
}

function FotosPrivadas({ paths }: { paths: string[] }) {
  const q = useQuery({ queryKey: ["consultora", "qualidade-fotos", paths], enabled: paths.length > 0, queryFn: () => urlsFotosTroca(paths), staleTime: 5 * 60_000 });
  if (paths.length === 0) return null;
  return <div className="mt-2 grid grid-cols-3 gap-2">{q.data?.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Foto da troca" className="aspect-square w-full rounded-lg object-cover" /></a>)}</div>;
}

function DetalheConsultora({ t }: { t: Troca }) {
  const qc = useQueryClient();
  const ev = useQuery({ queryKey: ["consultora", "qualidade-eventos", t.id], queryFn: () => eventosTroca(t.id) });
  React.useEffect(() => {
    if (!t.novidade_consultora) return;
    void supabase.rpc("qualidade_troca_marcar_lida", { _id: t.id }).then(() => qc.invalidateQueries({ queryKey: CHAVE_LISTA }));
  }, [t.id, t.novidade_consultora, qc]);
  const [texto, setTexto] = React.useState("");
  const [fotos, setFotos] = React.useState<File[]>([]);
  const [chave, setChave] = React.useState(() => crypto.randomUUID());
  const m = useMutation({
    mutationFn: async () => {
      const paths = await enviarFotosTroca(fotos, chave);
      const { error } = await supabase.rpc("qualidade_troca_mensagem", { _id: t.id, _texto: texto, _fotos: paths, _interno: false });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mensagem enviada para a Qualidade."); setTexto(""); setFotos([]); setChave(crypto.randomUUID()); void qc.invalidateQueries({ queryKey: ["consultora", "qualidade-eventos", t.id] }); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const finalizada = t.status === "resolvida" || t.status === "recusada";
  return (
    <div className="space-y-4">
      <DialogHeader><DialogTitle>{protocoloTroca(t.protocolo)}</DialogTitle><DialogDescription>{STATUS_TROCA_CONSULTORA[t.status]}</DialogDescription></DialogHeader>
      <div className="flex gap-3 rounded-2xl border border-border p-3"><FotoPeca variantId={t.dev_variant_id} alt={t.dev_nome ?? ""} size="lg" /><div className="min-w-0"><p className="text-sm text-muted-foreground">Peça devolvida</p><p className="font-semibold">{t.dev_referencia}</p><p className="text-[0.95rem]">{t.dev_nome}</p><p className="text-[0.95rem]">{t.dev_tamanho ? `Tam. ${t.dev_tamanho} · ` : ""}{brlTroca(t.dev_valor_cents)}</p></div></div>
      {(t.rep_referencia || t.rep_nome) && <div className="flex gap-3 rounded-2xl border border-success/50 p-3"><FotoPeca variantId={t.rep_variant_id} alt={t.rep_nome ?? ""} size="lg" /><div className="min-w-0"><p className="text-sm text-muted-foreground">{t.status === "resolvida" ? "Peça enviada para você" : "Peça que vai para você"}</p><p className="font-semibold">{t.rep_referencia}</p><p className="text-[0.95rem]">{t.rep_nome}</p><p className="text-[0.95rem]">{t.rep_tamanho ? `Tam. ${t.rep_tamanho} · ` : ""}{brlTroca(t.rep_valor_cents)}</p></div></div>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.98rem]">
        <dt className="text-muted-foreground">Motivo</dt><dd>{t.motivo}{t.observacao ? ` · ${t.observacao}` : ""}</dd>
        <dt className="text-muted-foreground">Aberta em</dt><dd>{dataHora(t.aberto_em)}</dd>
        {t.solucao && <><dt className="text-muted-foreground">Solução</dt><dd>{SOLUCAO_TROCA[t.solucao]}</dd></>}
        {t.diferenca_cents != null && t.diferenca_cents !== 0 && <><dt className="text-muted-foreground">Diferença</dt><dd>{brlTroca(t.diferenca_cents)}</dd></>}
        {t.parecer && <><dt className="text-muted-foreground">Resposta da Lardan</dt><dd className="font-medium">{t.parecer}</dd></>}
      </dl>
      <FotosPrivadas paths={Array.isArray(t.fotos) ? t.fotos : []} />
      <div><h3 className="mb-2 flex items-center gap-2 font-semibold"><MessageCircle className="size-5" aria-hidden /> Conversa com a Qualidade</h3>
        {ev.isLoading && <p>Carregando…</p>}
        {ev.data?.length === 0 && <p className="text-muted-foreground">Sem mensagens.</p>}
        <ol className="space-y-2">{ev.data?.map((e) => (
          <li key={e.id} className={cn("rounded-2xl px-3.5 py-2.5", e.autor === "consultora" ? "ml-8 bg-primary/10" : "mr-8 border border-border bg-card")}>
            <p className="text-xs text-muted-foreground">{e.autor === "consultora" ? "Você" : "Lardan"} · {dataHora(e.created_at)}{e.status ? ` · ${STATUS_TROCA_CONSULTORA[e.status as Troca["status"]] ?? e.status}` : ""}</p>
            {e.texto && <p className="whitespace-pre-wrap">{e.texto}</p>}
            <FotosPrivadas paths={Array.isArray(e.fotos) ? e.fotos : []} />
          </li>))}</ol>
        {!finalizada || t.status === "resolvida" ? (
          <div className="mt-3 space-y-2">
            <textarea aria-label="Mensagem para a Qualidade" className="admin-input min-h-20 w-full" maxLength={2000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva para a Qualidade da Lardan" />
            <div className="flex gap-2">
              <label className="admin-btn min-h-12 flex-1 cursor-pointer justify-center gap-2"><Camera className="size-5" aria-hidden /> {fotos.length ? `${fotos.length} foto(s)` : "Foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" onChange={(e) => setFotos(Array.from(e.target.files ?? []).slice(0, 3))} /></label>
              <Button className="min-h-12 flex-1 gap-2" disabled={m.isPending || (texto.trim().length < 2 && fotos.length === 0)} onClick={() => m.mutate()}><Send className="size-5" aria-hidden /> Enviar</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

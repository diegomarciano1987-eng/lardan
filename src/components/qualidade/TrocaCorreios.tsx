/**
 * Correios na troca (0251): código reverso para a consultora mandar a peça e envio da peça nova.
 * O código entra sozinho na conversa da troca (a consultora vê no app).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileDown, RefreshCw, Truck, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { trocaCorreiosCancelar, trocaCorreiosEnviar, trocaCorreiosEtiqueta, trocaCorreiosPrevia, trocaCorreiosRastrear } from "@/lib/correios/troca.functions";
import type { StatusTroca } from "@/lib/qualidade-trocas";

type Envio = { id: string; direcao: "volta" | "ida"; status: string; codigo_objeto: string | null; erro: string | null; created_at: string; entregue_em: string | null };
const ROTULO: Record<string, string> = { criando: "Gerando", pre_postada: "Código gerado, aguardando postagem", postada: "Postada", em_transito: "Em trânsito", entregue: "Entregue", erro: "Erro", cancelada: "Cancelada" };
const DIRECAO = { volta: { titulo: "Consultora manda a peça para a Lardan", botao: "Gerar código de postagem reversa", icone: Undo2 },
  ida: { titulo: "Lardan manda a peça para a consultora", botao: "Enviar peça pelos Correios", icone: Truck } } as const;

export function TrocaCorreios({ trocaId, status }: { trocaId: string; status: StatusTroca }) {
  const qc = useQueryClient();
  const chave = ["qualidade", "correios", trocaId];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.from("qualidade_correios_envios").select("id,direcao,status,codigo_objeto,erro,created_at,entregue_em").eq("troca_id", trocaId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as Envio[];
    },
  });
  const atualizar = () => { void qc.invalidateQueries({ queryKey: chave }); void qc.invalidateQueries({ queryKey: ["qualidade", "eventos", trocaId] }); };
  const rastrearFn = useServerFn(trocaCorreiosRastrear);
  const rastrear = useMutation({ mutationFn: () => rastrearFn({ data: { trocaId } }), onSuccess: (r) => { toast.success(`Rastreio atualizado (${r.consultados}).`); atualizar(); }, onError: (e: Error) => toast.error(e.message) });
  if (status === "resolvida" || status === "recusada") {
    if (!lista.data?.length) return null;
  }
  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Truck className="size-4" aria-hidden /> Correios</h3>
        {!!lista.data?.some((e) => e.codigo_objeto && ["pre_postada", "postada", "em_transito"].includes(e.status)) && (
          <Button variant="outline" size="sm" className="gap-1.5" disabled={rastrear.isPending} onClick={() => rastrear.mutate()}><RefreshCw className="size-3.5" /> Atualizar rastreio</Button>
        )}
      </div>
      {lista.data?.map((e) => <EnvioLinha key={e.id} e={e} onFeito={atualizar} />)}
      {status !== "resolvida" && status !== "recusada" && (["volta", "ida"] as const).map((d) => {
        const vivo = lista.data?.find((e) => e.direcao === d && !["erro", "cancelada"].includes(e.status));
        if (vivo) return null;
        if (d === "ida" && status !== "aguardando_envio") return <p key={d} className="text-xs text-ledger-muted">A peça nova vai pelos Correios depois que a troca estiver em "Aguardando envio".</p>;
        return <NovoEnvio key={d} trocaId={trocaId} direcao={d} onFeito={atualizar} />;
      })}
    </section>
  );
}

function NovoEnvio({ trocaId, direcao, onFeito }: { trocaId: string; direcao: "volta" | "ida"; onFeito: () => void }) {
  const [aberto, setAberto] = React.useState(false);
  const previaFn = useServerFn(trocaCorreiosPrevia);
  const enviarFn = useServerFn(trocaCorreiosEnviar);
  const previa = useQuery({ queryKey: ["qualidade", "correios-previa", trocaId, direcao], queryFn: () => previaFn({ data: { trocaId, direcao } }), enabled: aberto });
  const enviar = useMutation({
    mutationFn: () => enviarFn({ data: { trocaId, direcao } }),
    onSuccess: (r) => { toast.success(`Código ${r.codigoObjeto} gerado e enviado para a consultora na conversa.`); if (r.rotulo) window.open(r.rotulo, "_blank"); setAberto(false); onFeito(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const D = DIRECAO[direcao];
  if (!aberto) return <Button variant="outline" className="w-full gap-2" onClick={() => setAberto(true)}><D.icone className="size-4" /> {D.botao}</Button>;
  const p = previa.data;
  const end = (x?: { nome?: string | null; logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null }) =>
    x ? `${x.nome ?? ""} — ${x.logradouro ?? ""}, ${x.numero ?? ""} · ${x.bairro ?? ""} · ${x.cidade ?? ""}/${x.uf ?? ""} · CEP ${x.cep ?? ""}` : "";
  return (
    <div className="space-y-2 rounded-xl bg-cream-2/60 p-3 text-sm">
      <p className="font-semibold">{D.titulo}</p>
      {previa.isLoading && <p className="text-ledger-muted">Conferindo endereço…</p>}
      {previa.error && <p className="text-danger">{(previa.error as Error).message}</p>}
      {p && (
        <>
          <p><span className="text-ledger-muted">De:</span> {end(p.remetente as never)}</p>
          <p><span className="text-ledger-muted">Para:</span> {end(p.destinatario as never)}</p>
          <p><span className="text-ledger-muted">Valor declarado:</span> {(p.valor_declarado_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · PAC {direcao === "volta" ? "reverso (sem custo para ela)" : "contrato"}</p>
          {p.pendencias.length > 0 && <p className="text-danger">Falta: {p.pendencias.join("; ")}. Corrija no cadastro da consultora.</p>}
          {!p.configurado && <p className="text-danger">Correios não configurado.</p>}
        </>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setAberto(false)}>Voltar</Button>
        <Button disabled={!p || p.pendencias.length > 0 || !p.configurado || enviar.isPending} onClick={() => enviar.mutate()} className="flex-1">{enviar.isPending ? "Gerando…" : "Confirmar"}</Button>
      </div>
    </div>
  );
}

function EnvioLinha({ e, onFeito }: { e: Envio; onFeito: () => void }) {
  const etiquetaFn = useServerFn(trocaCorreiosEtiqueta);
  const cancelarFn = useServerFn(trocaCorreiosCancelar);
  const etiqueta = useMutation({ mutationFn: () => etiquetaFn({ data: { envioId: e.id } }), onSuccess: (r) => window.open(r.url, "_blank"), onError: (x: Error) => toast.error(x.message) });
  const cancelar = useMutation({ mutationFn: (motivo: string) => cancelarFn({ data: { envioId: e.id, motivo } }), onSuccess: () => { toast.success("Envio cancelado."); onFeito(); }, onError: (x: Error) => toast.error(x.message) });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
      <div>
        <p className="font-medium">{e.direcao === "volta" ? "Reversa (consultora → Lardan)" : "Peça nova (Lardan → consultora)"} {e.codigo_objeto && <span className="font-mono">· {e.codigo_objeto}</span>}</p>
        <p className="text-xs text-ledger-muted">{ROTULO[e.status] ?? e.status}{e.erro ? ` · ${e.erro}` : ""}</p>
      </div>
      <div className="flex gap-1.5">
        {e.codigo_objeto && e.direcao === "ida" && <Button size="sm" variant="outline" className="gap-1" disabled={etiqueta.isPending} onClick={() => etiqueta.mutate()}><FileDown className="size-3.5" /> Etiqueta</Button>}
        {e.status === "pre_postada" && (
          <Button size="sm" variant="ghost" className="gap-1" disabled={cancelar.isPending} onClick={() => { const m = window.prompt("Motivo do cancelamento"); if (m && m.trim().length >= 3) cancelar.mutate(m); }}><XCircle className="size-3.5" /> Cancelar</Button>
        )}
      </div>
    </div>
  );
}

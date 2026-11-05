/**
 * Assinatura digital (ZapSign) na tela da consultora: contrato e promissória
 * de cada maleta. O link vai sozinho pelo WhatsApp dela; o representante
 * também pode copiar o link e mandar. Situação atualiza pelo aviso da ZapSign.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, FileSignature, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { zapsignArquivo, zapsignEnviar } from "@/lib/zapsign/zapsign.functions";

interface Doc {
  id: string; tipo: "contrato" | "promissoria"; titulo: string; status: "pendente" | "assinado" | "recusado" | "cancelado" | "erro";
  ambiente: string; sign_url: string | null; cycle_id: string | null; maleta: string | null; valor_cents: number | null;
  criado_em: string; assinado_em: string | null; enviado_whatsapp: boolean;
}
interface Maleta { cycle_id: string; maleta: string; status: string; remessa: number | null; valor_cents: number }

const STATUS: Record<Doc["status"], { rotulo: string; cor: string }> = {
  pendente: { rotulo: "Aguardando assinatura", cor: "text-amber-600" },
  assinado: { rotulo: "Assinado", cor: "text-emerald-600" },
  recusado: { rotulo: "Recusado", cor: "text-destructive" },
  cancelado: { rotulo: "Cancelado", cor: "text-muted-foreground" },
  erro: { rotulo: "Erro", cor: "text-destructive" },
};
const brl = (c: number | null) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (s: string | null) => (s ? new Date(s).toLocaleDateString("pt-BR") : "");
const msg = (e: unknown) => (e instanceof Error ? e.message : "Falha.");

export function AssinaturaDigital({ party, rep }: { party: string; rep: string | null }) {
  const qc = useQueryClient();
  const enviarFn = useServerFn(zapsignEnviar);
  const arquivoFn = useServerFn(zapsignArquivo);
  const chave = ["assinaturas", party];
  const q = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("assinaturas_da_consultora" as never, { _party: party, _rep: rep } as never);
      if (error) throw error;
      return d as unknown as { documentos: Doc[]; maletas: Maleta[] };
    },
    refetchInterval: (qq) => ((qq.state.data as { documentos: Doc[] } | undefined)?.documentos.some((d) => d.status === "pendente") ? 20_000 : false),
  });
  const enviar = useMutation({
    mutationFn: (v: { tipo: "contrato" | "promissoria"; cycleId?: string; reenviar?: boolean }) =>
      enviarFn({ data: { tipo: v.tipo, partyId: party, cycleId: v.cycleId ?? null, rep, reenviar: v.reenviar ?? false } }),
    onSuccess: (r) => {
      if (r.jaExistia) toast.info("Já existe um documento aguardando assinatura. Copie o link ou use 'Reenviar'.");
      else toast.success(r.whatsapp ? "Enviado pelo WhatsApp da consultora." : "Documento criado. Copie o link e mande para ela.");
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(msg(e)),
  });
  const copiar = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copiado."); } catch { toast.message(url); }
  };
  const baixar = async (id: string) => {
    try {
      const r = await arquivoFn({ data: { id, rep } });
      if (r.url) window.open(r.url, "_blank", "noopener,noreferrer"); else toast.error("Arquivo ainda não disponível.");
      void qc.invalidateQueries({ queryKey: chave });
    } catch (e) { toast.error(msg(e)); }
  };

  const docs = q.data?.documentos ?? [];
  const contrato = docs.find((d) => d.tipo === "contrato" && d.status !== "cancelado");
  const promissoriaDa = (cycle: string) => docs.find((d) => d.tipo === "promissoria" && d.cycle_id === cycle && d.status !== "cancelado");

  const Linha = ({ d }: { d: Doc }) => (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`font-semibold ${STATUS[d.status].cor}`}>{STATUS[d.status].rotulo}</span>
      <span className="text-muted-foreground">{d.status === "assinado" ? `em ${data(d.assinado_em)}` : `enviado em ${data(d.criado_em)}`}</span>
      {d.ambiente === "sandbox" && <span className="rounded bg-muted px-1.5">teste</span>}
      {d.sign_url && <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => void copiar(d.sign_url!)}><Copy className="size-3" /> link</button>}
      {d.status === "assinado" && <button type="button" className="underline" onClick={() => void baixar(d.id)}>baixar assinado</button>}
    </div>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><FileSignature className="size-4" /> Assinatura digital</h3>
      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {q.error && <p className="text-sm text-destructive">{msg(q.error)}</p>}
      {q.data && (
        <>
          <div className="space-y-1.5 rounded-xl bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Contrato de consignação</p>
              {(!contrato || contrato.status === "recusado" || contrato.status === "erro") ? (
                <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "contrato" })}
                  className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">Enviar para assinar</button>
              ) : contrato.status === "pendente" ? (
                <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "contrato", reenviar: true })}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs"><RefreshCw className="size-3" /> Reenviar</button>
              ) : null}
            </div>
            {contrato && <Linha d={contrato} />}
          </div>

          {q.data.maletas.length === 0 && <p className="text-xs text-muted-foreground">A promissória aparece aqui quando ela tiver uma maleta.</p>}
          {q.data.maletas.map((m) => {
            const p = promissoriaDa(m.cycle_id);
            return (
              <div key={m.cycle_id} className="space-y-1.5 rounded-xl bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Promissória · maleta {m.maleta}{m.remessa ? ` · remessa ${m.remessa}` : ""} · {brl(m.valor_cents)}</p>
                  {(!p || p.status === "recusado" || p.status === "erro") ? (
                    <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "promissoria", cycleId: m.cycle_id })}
                      className="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">Enviar para assinar</button>
                  ) : p.status === "pendente" ? (
                    <button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate({ tipo: "promissoria", cycleId: m.cycle_id, reenviar: true })}
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs"><RefreshCw className="size-3" /> Reenviar</button>
                  ) : null}
                </div>
                {p && <Linha d={p} />}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

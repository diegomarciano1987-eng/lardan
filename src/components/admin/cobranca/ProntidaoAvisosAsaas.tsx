/**
 * 18/11/2026 (Diego): antes de gerar acordo/cobrança, a tela mostra — conferido AGORA no Asaas — se a cliente vai
 * receber o aviso por e-mail, SMS e WhatsApp, e o que falta (sem e-mail, celular errado, canal desligado…).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleAlert, Mail, MessageCircle, MessageSquareText, RefreshCw, Wrench, UserPen } from "lucide-react";
import { conferirAvisosAsaas, type ResultadoConferencia } from "@/lib/asaas/prontidao-avisos.functions";
import type { Canal } from "@/lib/asaas/prontidao-avisos";
import { EditarDadosDialog } from "./EditarDadosDialog";

export const chaveAvisos = (partyId: string) => ["cob", "avisos-asaas", partyId] as const;

const CANAIS: [Canal, string, typeof Mail][] = [["email", "E-mail", Mail], ["sms", "SMS", MessageSquareText], ["whatsapp", "WhatsApp", MessageCircle]];

export function useProntidaoAvisos(partyId: string) {
  const fn = useServerFn(conferirAvisosAsaas);
  return useQuery({
    queryKey: chaveAvisos(partyId),
    queryFn: () => fn({ data: { partyId, corrigir: false } }) as Promise<ResultadoConferencia>,
    staleTime: 60_000,
    retry: false,
  });
}

export function ProntidaoAvisosAsaas({ partyId }: { partyId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(conferirAvisosAsaas);
  const q = useProntidaoAvisos(partyId);
  const [corrigindo, setCorrigindo] = React.useState(false);
  const [editar, setEditar] = React.useState(false);
  const r = q.data;

  const corrigir = async () => {
    if (!confirm("Enviar o e-mail e o celular do Lardan para o cadastro dela no Asaas e ligar os avisos (e-mail, SMS e WhatsApp)?")) return;
    setCorrigindo(true);
    try {
      const x = await fn({ data: { partyId, corrigir: true } });
      qc.setQueryData(chaveAvisos(partyId), x);
      if (x.pronto) toast.success("Corrigido no Asaas e conferido de novo: ela recebe por e-mail, SMS e WhatsApp.");
      else toast.warning(`Corrigido o que dava no Asaas. Ainda falta: ${x.faltas.join(", ") || "ver lista"}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "O Asaas não respondeu."); } finally { setCorrigindo(false); }
  };

  const falta = r?.itens.filter((i) => i.status !== "ok") ?? [];
  const ok = r?.itens.filter((i) => i.status === "ok") ?? [];
  const asaasCorrige = falta.some((i) => i.resolve === "asaas");
  const lardanCorrige = falta.some((i) => i.resolve === "lardan");

  return (
    <section className="rounded-xl border border-asaas/40 bg-surface p-4" data-prontidao-avisos aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-asaas">Avisos do Asaas para esta cliente</h3>
          <p className="text-xs text-ledger-muted">
            {q.isFetching ? "Conferindo agora no Asaas…" : r ? `Conferido no Asaas às ${new Date(r.conferidoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {CANAIS.map(([c, rot, I]) => {
            const vai = r?.canais[c];
            return (
              <span key={c} data-canal={c} data-vai={vai ? "sim" : "nao"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${!r ? "border-line text-ledger-muted" : vai ? "border-success/40 bg-success/10 text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>
                <I aria-hidden className="size-3.5" />{rot}: {!r ? "…" : vai ? "vai receber" : "NÃO vai"}
              </span>
            );
          })}
        </div>
      </div>

      {q.error && <p className="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-danger">Não consegui conferir no Asaas: {(q.error as Error).message}</p>}

      {r && falta.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {falta.map((i) => (
            <li key={i.chave} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${i.status === "falta" ? "bg-danger/10 text-danger" : "bg-warm-ivory text-ledger-text"}`}>
              {i.status === "falta" ? <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />}
              <span><b>{i.titulo}:</b> {i.detalhe}</span>
            </li>
          ))}
        </ul>
      )}
      {r && ok.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ledger-muted">
          {ok.map((i) => <span key={i.chave} className="inline-flex items-center gap-1"><CheckCircle2 aria-hidden className="size-3.5 text-success" />{i.titulo}: {i.detalhe}</span>)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {lardanCorrige && (
          <button type="button" onClick={() => setEditar(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold">
            <UserPen aria-hidden className="size-3.5" />Completar cadastro (e-mail / celular / CPF)
          </button>
        )}
        {asaasCorrige && (
          <button type="button" disabled={corrigindo} onClick={corrigir} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-asaas px-3 text-xs font-semibold text-asaas-foreground disabled:opacity-50">
            <Wrench aria-hidden className="size-3.5" />{corrigindo ? "Corrigindo no Asaas…" : "Corrigir no Asaas e conferir"}
          </button>
        )}
        <button type="button" disabled={q.isFetching} onClick={() => q.refetch()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-asaas/50 px-3 text-xs font-semibold text-asaas disabled:opacity-50">
          <RefreshCw aria-hidden className={`size-3.5 ${q.isFetching ? "animate-spin" : ""}`} />Conferir de novo
        </button>
      </div>
      <EditarDadosDialog open={editar} onOpenChange={setEditar} partyId={partyId} onSalvo={() => { qc.invalidateQueries({ queryKey: chaveAvisos(partyId) }); qc.invalidateQueries({ queryKey: ["cob", "historica-contatos"] }); }} />
    </section>
  );
}

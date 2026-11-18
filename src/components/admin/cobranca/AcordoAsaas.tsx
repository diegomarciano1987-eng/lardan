import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR } from "@/lib/cobranca";
import { gerarCobrancasAcordo } from "@/lib/cobranca-asaas.functions";
import { conferirAvisosAsaas, reenviarAvisosAcordo, type ResultadoConferencia } from "@/lib/asaas/prontidao-avisos.functions";
import { fraseFaltas } from "@/lib/asaas/prontidao-avisos";
import { chaveAvisos } from "./ProntidaoAvisosAsaas";

interface Linha { parcela: number; intent_id: string; state: string; valor_cents: number; vencimento: string; forma: string; invoice_url: string | null; external_status: string | null; erro: string | null }
const ROT: Record<string, string> = { RECEIVED: "paga", CONFIRMED: "paga", PENDING: "aguardando pagamento", OVERDUE: "vencida" };

export function AcordoAsaas({ simId, partyId, temEntrada }: { simId: string; partyId?: string; temEntrada: boolean }) {
  const qc = useQueryClient();
  const gerar = useServerFn(gerarCobrancasAcordo);
  const conferir = useServerFn(conferirAvisosAsaas);
  const reenviar = useServerFn(reenviarAvisosAcordo);
  const [reenviando, setReenviando] = React.useState(false);
  const q = useQuery({ queryKey: ["cob", "acordo-asaas", simId], queryFn: async () => {
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>)("cob_acordo_cobrancas", { _sim: simId });
    if (error) throw new Error(error.message);
    return (data ?? []) as Linha[];
  } });
  const [forma, setForma] = React.useState<"UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD">("UNDEFINED");
  const [entrada, setEntrada] = React.useState(false);
  const [indo, setIndo] = React.useState(false);

  // 18/11 (Diego): antes de gerar, confere no Asaas se ela vai receber os avisos; se faltar dado, avisa e pede confirmação.
  const prontidao = async (): Promise<ResultadoConferencia | null> => {
    if (!partyId) return null;
    const cache = qc.getQueryData<ResultadoConferencia>(chaveAvisos(partyId));
    if (cache) return cache;
    try { const x = await conferir({ data: { partyId, corrigir: false } }); qc.setQueryData(chaveAvisos(partyId), x); return x; } catch { return null; }
  };
  const enviar = async () => {
    setIndo(true);
    try {
      const p = await prontidao();
      if (partyId && !p && !confirm("Não consegui conferir no Asaas se ela vai receber os avisos. Gerar as cobranças mesmo assim?")) return;
      if (p && !p.pronto && !confirm(`${fraseFaltas(p)}\n\nCorrija acima antes ("Completar cadastro" ou "Corrigir no Asaas").\nGerar as cobranças mesmo assim?`)) return;
      const r = await gerar({ data: { simId, forma, incluirEntrada: entrada } });
      if (r.erros.length) toast.error(`${r.cobrancas - r.erros.length} de ${r.cobrancas} criadas. ${r.erros[0]}`);
      else toast.success(`${r.cobrancas} cobrança(s) criadas no Asaas e aviso pedido ao Asaas para cada uma.`);
      qc.invalidateQueries({ queryKey: ["cob"] });
      if (partyId) {
        // o Asaas liga os avisos do cadastro ao criar; confere de novo e mostra o resultado real
        const x = await conferir({ data: { partyId, corrigir: false } }).catch(() => null);
        if (x) {
          qc.setQueryData(chaveAvisos(partyId), x);
          if (x.pronto) toast.success("Conferido no Asaas: ela recebe por e-mail, SMS e WhatsApp.");
          else toast.warning(`Atenção: ela NÃO recebe por ${x.faltas.join(", ")}. Veja o quadro azul do Asaas.`, { duration: 12000 });
        }
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } finally { setIndo(false); }
  };
  const reenviarAvisos = async () => {
    setReenviando(true);
    try {
      const r = await reenviar({ data: { simId } });
      if (!r.abertas) toast.info("Nenhuma parcela aberta no Asaas para avisar.");
      else if (r.falhas.length) toast.warning(`${r.enviados} de ${r.abertas} aviso(s) reenviados. ${r.falhas[0]}`);
      else toast.success(`${r.enviados} aviso(s) reenviados pelo Asaas (e-mail, SMS e WhatsApp ativos no cadastro dela).`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } finally { setReenviando(false); }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-asaas/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select aria-label="Forma de pagamento" value={forma} onChange={(e) => setForma(e.target.value as typeof forma)} className="h-9 rounded-lg border border-border bg-background px-2">
          <option value="UNDEFINED">Cliente escolhe (Pix, boleto ou cartão)</option><option value="PIX">Pix</option><option value="BOLETO">Boleto</option><option value="CREDIT_CARD">Cartão até 12x</option>
        </select>
        {temEntrada && <label className="flex items-center gap-1"><input type="checkbox" checked={entrada} onChange={(e) => setEntrada(e.target.checked)} />Incluir a entrada</label>}
        <button disabled={indo} onClick={enviar} className="h-9 rounded-lg bg-asaas px-4 font-semibold text-asaas-foreground disabled:opacity-50">{indo ? "Enviando…" : "Gerar cobranças no Asaas"}</button>
      </div>
      {(q.data ?? []).some((l) => l.invoice_url) && (
        <button type="button" onClick={() => {
          const linhas = (q.data ?? []).filter((l) => l.invoice_url && !["RECEIVED", "CONFIRMED", "DELETED"].includes(l.external_status ?? "")).map((l) => `${l.parcela === 0 ? "Entrada" : `${l.parcela}ª parcela`} — ${brl(Number(l.valor_cents))} — vence ${dataBR(l.vencimento)}: ${l.invoice_url}`);
          void navigator.clipboard.writeText(`Olá! Seguem os dados para pagamento do seu acordo (Pix, boleto ou cartão pelo link de cada parcela):\n\n${linhas.join("\n")}`);
          toast.success("Mensagem com os links de pagamento copiada.");
        }} className="h-8 rounded-lg border border-asaas/50 px-3 text-xs font-semibold text-asaas">Copiar dados para pagamento</button>
      )}
      {(q.data ?? []).some((l) => ["PENDING", "OVERDUE"].includes(l.external_status ?? "")) && (
        <button type="button" disabled={reenviando} onClick={reenviarAvisos} className="ml-2 h-8 rounded-lg border border-asaas/50 px-3 text-xs font-semibold text-asaas disabled:opacity-50">
          {reenviando ? "Reenviando…" : "Reenviar avisos pelo Asaas"}
        </button>
      )}
      {(q.data ?? []).length > 0 && <ul className="space-y-1 text-xs">{q.data!.map((l) => (
        <li key={l.intent_id}>{l.parcela === 0 ? "Entrada" : `${l.parcela}ª`} · {dataBR(l.vencimento)} · <span className="font-mono">{brl(Number(l.valor_cents))}</span> · {l.external_status ? ROT[l.external_status] ?? l.external_status : l.state}
          {l.invoice_url && <> · <a className="underline" href={l.invoice_url} target="_blank" rel="noopener noreferrer">abrir fatura</a></>}{l.erro && <span className="text-destructive"> — {l.erro}</span>}</li>
      ))}</ul>}
    </div>
  );
}

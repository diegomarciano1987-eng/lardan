import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR } from "@/lib/cobranca";
import { gerarCobrancasAcordo } from "@/lib/cobranca-asaas.functions";

interface Linha { parcela: number; intent_id: string; state: string; valor_cents: number; vencimento: string; forma: string; invoice_url: string | null; external_status: string | null; erro: string | null }
const ROT: Record<string, string> = { RECEIVED: "paga", CONFIRMED: "paga", PENDING: "aguardando pagamento", OVERDUE: "vencida" };

export function AcordoAsaas({ simId, temEntrada }: { simId: string; temEntrada: boolean }) {
  const qc = useQueryClient();
  const gerar = useServerFn(gerarCobrancasAcordo);
  const q = useQuery({ queryKey: ["cob", "acordo-asaas", simId], queryFn: async () => {
    const { data, error } = await (supabase.rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>)("cob_acordo_cobrancas", { _sim: simId });
    if (error) throw new Error(error.message);
    return (data ?? []) as Linha[];
  } });
  const [forma, setForma] = React.useState<"UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD">("UNDEFINED");
  const [entrada, setEntrada] = React.useState(false);
  const [indo, setIndo] = React.useState(false);

  const enviar = async () => {
    setIndo(true);
    try {
      const r = await gerar({ data: { simId, forma, incluirEntrada: entrada } });
      if (r.erros.length) toast.error(`${r.cobrancas - r.erros.length} de ${r.cobrancas} criadas. ${r.erros[0]}`);
      else toast.success(`${r.cobrancas} cobrança(s) criadas no Asaas.`);
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } finally { setIndo(false); }
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
      {(q.data ?? []).length > 0 && <ul className="space-y-1 text-xs">{q.data!.map((l) => (
        <li key={l.intent_id}>{l.parcela === 0 ? "Entrada" : `${l.parcela}ª`} · {dataBR(l.vencimento)} · <span className="font-mono">{brl(Number(l.valor_cents))}</span> · {l.external_status ? ROT[l.external_status] ?? l.external_status : l.state}
          {l.invoice_url && <> · <a className="underline" href={l.invoice_url} target="_blank" rel="noopener noreferrer">abrir fatura</a></>}{l.erro && <span className="text-destructive"> — {l.erro}</span>}</li>
      ))}</ul>}
    </div>
  );
}

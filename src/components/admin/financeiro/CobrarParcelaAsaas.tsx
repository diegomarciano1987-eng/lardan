/**
 * Botão azul Asaas para cobrar UMA parcela a receber (Pix, boleto ou link).
 * Abre uma janela: se a parcela já tem cobrança no Asaas mostra a situação,
 * copiar e WhatsApp; senão gera pela rotina oficial (idempotente — nunca duplica).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { gerarLinkCobranca } from "@/lib/asaas/cobranca.functions";

type Forma = "PIX" | "BOLETO" | "UNDEFINED";
const FORMAS: { id: Forma; rotulo: string; dica: string }[] = [
  { id: "PIX", rotulo: "Pix", dica: "QR Code e copia e cola" },
  { id: "BOLETO", rotulo: "Boleto", dica: "linha digitável + Pix" },
  { id: "UNDEFINED", rotulo: "Link completo", dica: "cliente escolhe Pix, boleto ou cartão" },
];
const ESTADOS: Record<string, string> = {
  RECEIVED: "Paga", CONFIRMED: "Confirmada", PENDING: "Aguardando pagamento", OVERDUE: "Vencida",
  DUNNING_REQUESTED: "Em negativação", RECEIVED_IN_CASH: "Recebida em dinheiro",
};
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));

export function CobrarParcelaAsaas({ installmentId, saldoCents, vencimento, nome, telefone, compacto }: {
  installmentId: string; saldoCents: number; vencimento: string; nome?: string | null; telefone?: string | null; compacto?: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState<Forma>("PIX");
  const [aviso, setAviso] = React.useState<string | null>(null);
  const qc = useQueryClient();
  const gerar = useServerFn(gerarLinkCobranca);

  const cob = useQuery({
    queryKey: ["asaas-cobranca-parcela", installmentId],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await supabase.from("asaas_charges")
        .select("id, external_id, external_status, billing_type, invoice_url, value_cents, due_date")
        .eq("installment_id", installmentId).neq("external_status", "DELETED")
        .order("imported_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const emitir = useMutation({
    mutationFn: () => gerar({ data: { installmentId, billingType: forma } }),
    onSuccess: (r) => {
      const x = r as { state: string; aviso?: string; reaproveitada?: boolean; invoice_url?: string | null; erro?: string | null };
      if (x.state === "indisponivel") setAviso(x.aviso ?? "Integração indisponível neste momento.");
      else if (x.invoice_url) {
        setAviso(x.reaproveitada ? "Já existia cobrança para esta parcela: reaproveitada, nada duplicado." : "Cobrança criada no Asaas.");
        toast.success("Cobrança pronta para enviar.");
      } else setAviso(x.erro ?? `Situação: ${x.state}.`);
      void qc.invalidateQueries({ queryKey: ["asaas-cobranca-parcela", installmentId] });
      void qc.invalidateQueries({ queryKey: ["fin-pagar-receber"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const c = cob.data;
  const fone = (telefone ?? "").replace(/\D/g, "");
  const whats = (u: string, v: number) =>
    `https://wa.me/${fone ? (fone.startsWith("55") ? fone : `55${fone}`) : ""}?text=${encodeURIComponent(
      `Olá${nome ? `, ${nome.split(" ")[0]}` : ""}! Segue o link para pagamento de ${brl(v)} — LARDAN: ${u}`)}`;

  return (
    <>
      <button type="button" data-testid="btn-cobrar-asaas"
        onClick={(e) => { e.stopPropagation(); setAviso(null); setAberto(true); }}
        className={`inline-flex items-center rounded-[8px] bg-asaas font-semibold text-asaas-foreground ${compacto ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"}`}>
        Cobrar no Asaas
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent onClick={(e) => e.stopPropagation()} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cobrar no Asaas</DialogTitle>
            <DialogDescription>
              {nome ? `${nome} · ` : ""}{brl(saldoCents)} · vence {dataBR(vencimento)}. A cobrança sai em nome da Lardan e a baixa é automática quando pagar.
            </DialogDescription>
          </DialogHeader>
          {cob.isLoading ? <p className="text-sm text-muted-foreground">Verificando se já existe cobrança…</p> : c ? (
            <div className="space-y-3 rounded-[10px] border border-asaas/40 p-4" data-testid="cobranca-existente">
              <p className="text-sm">Já existe cobrança <b>{c.external_id}</b> · {c.billing_type === "BOLETO" ? "Boleto" : c.billing_type === "PIX" ? "Pix" : "Link"} ·{" "}
                <b>{ESTADOS[c.external_status ?? ""] ?? c.external_status}</b></p>
              {c.invoice_url ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="admin-btn" onClick={() => { void navigator.clipboard.writeText(c.invoice_url!); toast.success("Link copiado."); }}>Copiar Pix / boleto</button>
                  <a className="admin-btn" target="_blank" rel="noreferrer" href={whats(c.invoice_url, c.value_cents ?? saldoCents)}>WhatsApp</a>
                  <a className="admin-btn" target="_blank" rel="noreferrer" href={c.invoice_url}>Abrir fatura</a>
                </div>
              ) : <p className="text-xs text-muted-foreground">Sem link de fatura no espelho; sincronize o Asaas.</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Forma de cobrança">
                {FORMAS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={forma === f.id} onClick={() => setForma(f.id)}
                    className={`rounded-[10px] border px-2 py-2 text-left text-xs ${forma === f.id ? "border-asaas bg-asaas text-asaas-foreground" : "border-border text-muted-foreground"}`}>
                    <span className="block font-semibold">{f.rotulo}</span><span className="opacity-80">{f.dica}</span>
                  </button>
                ))}
              </div>
              <button type="button" disabled={emitir.isPending} onClick={() => emitir.mutate()}
                className="w-full rounded-[10px] bg-asaas px-4 py-2.5 text-sm font-semibold text-asaas-foreground disabled:opacity-50">
                {emitir.isPending ? "Gerando no Asaas…" : "Gerar cobrança"}
              </button>
            </div>
          )}
          {aviso && <p className="text-sm font-medium" data-testid="aviso-asaas">{aviso}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

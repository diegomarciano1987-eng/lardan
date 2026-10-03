/**
 * Cobrar pelo Asaas direto da ficha do título: Pix, boleto ou link de pagamento.
 * A emissão passa pela rotina oficial do servidor (preflight, intenção
 * idempotente, reaproveita cobrança existente). Quando o Asaas confirma o
 * pagamento, a baixa entra sozinha pelo webhook.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { formatBRLFromCents } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { gerarLinkCobranca } from "@/lib/asaas/cobranca.functions";

type Parcela = { id: string; numero: number; vencimento: string; saldo: number };
type Forma = "PIX" | "BOLETO" | "UNDEFINED";
const FORMAS: { id: Forma; rotulo: string; dica: string }[] = [
  { id: "PIX", rotulo: "Pix", dica: "QR Code e copia e cola" },
  { id: "BOLETO", rotulo: "Boleto", dica: "linha digitável + Pix" },
  { id: "UNDEFINED", rotulo: "Link de pagamento", dica: "cliente escolhe Pix, boleto ou cartão" },
];
const ESTADOS: Record<string, string> = {
  RECEIVED: "Paga no Asaas",
  CONFIRMED: "Confirmada (aguardando crédito)",
  PENDING: "Aguardando pagamento",
  OVERDUE: "Vencida",
  DUNNING_REQUESTED: "Em negativação",
  DELETED: "Removida",
};
const dataBR = (d: string) => new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`));

export function CobrarAsaas({ tituloId, parcelas, telefone }: { tituloId: string; parcelas: Parcela[]; telefone?: string | null }) {
  const qc = useQueryClient();
  const gerar = useServerFn(gerarLinkCobranca);
  const abertas = parcelas.filter((p) => p.saldo > 0);
  const [parcela, setParcela] = React.useState(abertas[0]?.id ?? "");
  const [forma, setForma] = React.useState<Forma>("PIX");
  const [aviso, setAviso] = React.useState<string | null>(null);

  const cobrancas = useQuery({
    queryKey: ["asaas-cobrancas-titulo", tituloId],
    queryFn: async () => {
      const ids = parcelas.map((p) => p.id);
      const { data, error } = await supabase
        .from("asaas_charges")
        .select("id, external_id, installment_id, external_status, billing_type, invoice_url, value_cents, due_date")
        .in("installment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const emitir = useMutation({
    mutationFn: () => gerar({ data: { installmentId: parcela, billingType: forma } }),
    onSuccess: (r) => {
      const x = r as { state: string; aviso?: string; reaproveitada?: boolean; invoice_url?: string | null; erro?: string | null };
      if (x.state === "indisponivel") setAviso(x.aviso ?? "Integração indisponível neste momento.");
      else if (x.invoice_url) {
        setAviso(x.reaproveitada ? "Esta parcela já tinha cobrança no Asaas: reaproveitada, nada duplicado." : "Cobrança criada no Asaas.");
        toast.success("Cobrança pronta para enviar.");
      } else setAviso(x.erro ?? `Situação: ${x.state}. Acompanhe em Recebíveis Asaas.`);
      void qc.invalidateQueries({ queryKey: ["asaas-cobrancas-titulo", tituloId] });
      void qc.invalidateQueries({ queryKey: ["asaas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copiar = async (u: string) => {
    await navigator.clipboard.writeText(u);
    toast.success("Link copiado.");
  };
  const whats = (u: string, valor: number) => {
    const fone = (telefone ?? "").replace(/\D/g, "");
    const txt = encodeURIComponent(`Olá! Segue o link para pagamento de ${formatBRLFromCents(valor)} — LARDAN: ${u}`);
    return `https://wa.me/${fone ? (fone.startsWith("55") ? fone : `55${fone}`) : ""}?text=${txt}`;
  };

  const lista = cobrancas.data ?? [];

  return (
    <section className="rounded-[12px] border border-asaas/40 p-4" data-testid="cobrar-asaas">
      <div className="flex items-center justify-between gap-3">
        <p className="ledger-eyebrow text-asaas">Cobrar pelo Asaas</p>
        <span className="rounded-full bg-asaas px-2.5 py-0.5 text-[11px] font-semibold text-asaas-foreground">baixa automática ao pagar</span>
      </div>

      {lista.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft border-y border-line-soft">
          {lista.map((c) => {
            const p = parcelas.find((x) => x.id === c.installment_id);
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span className="text-sm text-ledger-text">
                  Parcela {p?.numero ?? "—"} · {c.billing_type === "UNDEFINED" ? "Link" : c.billing_type === "BOLETO" ? "Boleto" : "Pix"} ·{" "}
                  <strong>{ESTADOS[c.external_status ?? ""] ?? c.external_status ?? "—"}</strong>
                  {c.due_date ? ` · vence ${dataBR(c.due_date)}` : ""}
                </span>
                {c.invoice_url && (
                  <span className="flex gap-2">
                    <a href={c.invoice_url} target="_blank" rel="noreferrer" className="admin-btn">Abrir fatura</a>
                    <button type="button" className="admin-btn" onClick={() => void copiar(c.invoice_url!)}>Copiar link</button>
                    <a href={whats(c.invoice_url, c.value_cents ?? 0)} target="_blank" rel="noreferrer" className="admin-btn">WhatsApp</a>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {abertas.length === 0 ? (
        <p className="mt-3 text-sm text-ledger-muted">Nenhuma parcela em aberto para cobrar.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SmartSelect
              options={abertas.map((p) => ({ value: p.id, label: `Parcela ${p.numero} — ${dataBR(p.vencimento)}`, hint: formatBRLFromCents(p.saldo) }))}
              value={parcela}
              onChange={setParcela}
              placeholder="Parcela"
            />
            <div className="flex gap-2" role="group" aria-label="Forma de cobrança">
              {FORMAS.map((f) => (
                <button key={f.id} type="button" aria-pressed={forma === f.id} title={f.dica} onClick={() => setForma(f.id)}
                  className={`flex-1 rounded-[10px] border px-2 py-2 text-xs font-semibold ${forma === f.id ? "border-asaas bg-asaas text-asaas-foreground" : "border-line text-ledger-muted"}`}>
                  {f.rotulo}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="mt-3 rounded-[10px] bg-asaas px-4 py-2.5 text-sm font-semibold text-asaas-foreground disabled:opacity-50"
            disabled={!parcela || emitir.isPending} onClick={() => emitir.mutate()}>
            {emitir.isPending ? "Gerando no Asaas…" : `Gerar ${FORMAS.find((f) => f.id === forma)!.rotulo.toLowerCase()}`}
          </button>
        </>
      )}
      {aviso && <p className="mt-3 text-sm font-medium text-ledger-text" data-testid="aviso-asaas">{aviso}</p>}
    </section>
  );
}

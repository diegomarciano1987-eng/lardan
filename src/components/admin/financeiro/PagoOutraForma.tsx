import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { formatBRLFromCents } from "@/components/admin/ui";
import { marcarPagoOutraForma, retentarCancelamentoOutraForma } from "@/lib/asaas/outra-forma.functions";

const FORMAS = [
  { value: "pix", label: "Pix direto na conta" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência / TED" },
  { value: "cartao_maquininha", label: "Cartão na maquininha" },
  { value: "outro", label: "Outra forma" },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const paraCentavos = (t: string) => { const n = Number(t.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export function PagoOutraForma({ chargeId, saldoCents, status }: { chargeId: string; saldoCents: number; status: string | null }) {
  const qc = useQueryClient();
  const marcar = useServerFn(marcarPagoOutraForma);
  const retentar = useServerFn(retentarCancelamentoOutraForma);
  const [aberto, setAberto] = React.useState(false);
  const [conta, setConta] = React.useState("");
  const [dia, setDia] = React.useState<Date | undefined>(new Date());
  const [valor, setValor] = React.useState((saldoCents / 100).toFixed(2).replace(".", ","));
  const [forma, setForma] = React.useState("pix");
  const [obs, setObs] = React.useState("");
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [indo, setIndo] = React.useState(false);

  const baixa = useQuery({ queryKey: ["asaas", "outra-forma", chargeId], queryFn: async () => {
    const { data } = await supabase.from("asaas_baixas_outra_forma").select("id,valor_cents,data,forma,cancel_status,cancel_erro").eq("charge_id", chargeId).maybeSingle();
    return data;
  } });
  const contas = useQuery({ queryKey: ["fin", "contas-ativas"], enabled: aberto, queryFn: async () => {
    const { data } = await supabase.from("financial_accounts").select("id,nome").eq("is_active", true).is("excluida_em", null).order("nome");
    return data ?? [];
  } });
  const atualizar = () => { void qc.invalidateQueries({ queryKey: ["asaas"] }); void qc.invalidateQueries({ queryKey: ["fin"] }); };

  if (baixa.data) {
    const b = baixa.data;
    return (
      <div className="mt-5 rounded-lg border border-line px-4 py-3 text-sm" data-testid="pago-outra-forma">
        <p className="font-semibold">Pago por outra forma: {formatBRLFromCents(b.valor_cents)} em {new Date(`${b.data}T12:00:00`).toLocaleDateString("pt-BR")}</p>
        {b.cancel_status === "cancelado" ? <p className="text-ledger-muted">Cobrança cancelada no Asaas — a cliente não recebe mais o link.</p> : (
          <>
            <p className="text-danger">A baixa foi feita, mas a cobrança ainda NÃO foi cancelada no Asaas{b.cancel_erro ? `: ${b.cancel_erro}` : "."}</p>
            <button type="button" disabled={indo} className="admin-btn mt-2" onClick={async () => {
              setIndo(true);
              try { const r = await retentar({ data: { baixaId: b.id } }); r.cancelado ? toast.success("Cobrança cancelada no Asaas.") : toast.error(`Ainda não cancelou: ${r.erro}`); atualizar(); }
              catch (e) { toast.error((e as Error).message); } finally { setIndo(false); }
            }}>Tentar cancelar no Asaas de novo</button>
          </>
        )}
      </div>
    );
  }
  if (!status || !["PENDING", "OVERDUE"].includes(status) || saldoCents <= 0) return null;

  const enviar = async () => {
    const falta: string[] = [];
    if (!conta) falta.push("a conta onde o dinheiro entrou");
    if (!dia) falta.push("a data do pagamento");
    if (paraCentavos(valor) <= 0) falta.push("o valor recebido");
    if (falta.length) { toast.error(`Falta preencher ${falta.join(", ")}.`); return; }
    setIndo(true);
    try {
      let arq: { nome: string; tipo: string; base64: string } | null = null;
      if (arquivo) {
        const buf = new Uint8Array(await arquivo.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        arq = { nome: arquivo.name, tipo: arquivo.type, base64: btoa(bin) };
      }
      const r = await marcar({ data: { chargeId, contaId: conta, data: iso(dia!), valorCents: paraCentavos(valor), forma, observacao: obs, arquivo: arq } });
      r.cancelado ? toast.success("Baixa feita e cobrança cancelada no Asaas.") : toast.warning(`Baixa feita, mas o Asaas não cancelou ainda: ${r.erro}`);
      setAberto(false); atualizar();
    } catch (e) { toast.error((e as Error).message); } finally { setIndo(false); }
  };

  if (!aberto) return <button type="button" className="admin-btn mt-5" onClick={() => setAberto(true)}>Pago por outra forma</button>;
  return (
    <div className="mt-5 space-y-3 rounded-lg border border-bronze px-4 py-4 text-sm">
      <p className="font-semibold">Pago por outra forma</p>
      <p className="text-xs text-ledger-muted">Dá baixa oficial na parcela e cancela este link no Asaas na hora, para a cliente não pagar duas vezes.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs">Conta onde o dinheiro entrou</span>
          <SmartSelect options={(contas.data ?? []).map((c) => ({ value: c.id, label: c.nome }))} value={conta} onChange={setConta} placeholder={contas.isLoading ? "Carregando…" : "Escolha a conta"} /></label>
        <label className="block"><span className="mb-1 block text-xs">Forma</span>
          <SmartSelect options={FORMAS} value={forma} onChange={setForma} placeholder="Forma" /></label>
        <div><span className="mb-1 block text-xs">Data do pagamento</span><DateField value={dia} onChange={setDia} toYear={new Date().getFullYear()} /></div>
        <label className="block"><span className="mb-1 block text-xs">Valor recebido (R$)</span>
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full rounded-lg border border-line bg-transparent px-3 py-2 tabular-nums" /></label>
      </div>
      <label className="block"><span className="mb-1 block text-xs">Observação (opcional)</span>
        <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} className="w-full rounded-lg border border-line bg-transparent px-3 py-2" /></label>
      <label className="block"><span className="mb-1 block text-xs">Comprovante (opcional — foto ou PDF)</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-xs" /></label>
      <div className="flex gap-2">
        <button type="button" disabled={indo} onClick={enviar} className="rounded-lg bg-bronze px-4 py-2 font-semibold text-background disabled:opacity-50">{indo ? "Registrando…" : "Confirmar baixa e cancelar no Asaas"}</button>
        <button type="button" className="admin-btn" onClick={() => setAberto(false)}>Voltar</button>
      </div>
    </div>
  );
}

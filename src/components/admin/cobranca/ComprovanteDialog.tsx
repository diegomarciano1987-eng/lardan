import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DateField } from "@/components/premium/DateField";
import { enviarComprovante } from "@/lib/cobranca.functions";
import { hojeSP } from "@/lib/cobranca";

const iso = (d?: Date) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
const reais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".") || 0) * 100);

export function ComprovanteDialog({ open, onOpenChange, partyId, simulacaoId, referente, valorSugerido, onSalvo }: {
  open: boolean; onOpenChange: (v: boolean) => void; partyId: string; simulacaoId?: string | null | undefined; referente: string; valorSugerido?: number | undefined; onSalvo: () => void;
}) {
  const enviar = useServerFn(enviarComprovante);
  const [valor, setValor] = React.useState("");
  const [data, setData] = React.useState(hojeSP());
  const [banco, setBanco] = React.useState("");
  const [obs, setObs] = React.useState("");
  const [arq, setArq] = React.useState<File | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  React.useEffect(() => { if (open) { setValor(valorSugerido ? (valorSugerido / 100).toFixed(2).replace(".", ",") : ""); setArq(null); setObs(""); setBanco(""); setData(hojeSP()); } }, [open, valorSugerido]);
  const inp = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm";

  const salvar = async () => {
    if (!arq) { toast.error("Anexe o comprovante (foto ou PDF)."); return; }
    if (arq.size > 10 * 1024 * 1024) { toast.error("Arquivo maior que 10 MB."); return; }
    setSalvando(true);
    try {
      const b64 = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = erro; r.readAsDataURL(arq); });
      await enviar({ data: { partyId, simulacaoId: simulacaoId ?? null, referente, valorCents: reais(valor), dataPagamento: data, banco, observacao: obs, arquivoNome: arq.name, arquivoTipo: arq.type, arquivoBase64: b64 } });
      toast.success("Comprovante anexado. O financeiro faz a baixa conferindo o extrato.");
      onOpenChange(false); onSalvo();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não anexou."); } finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Comprovante de pagamento</DialogTitle>
          <DialogDescription>Para Pix ou depósito feito em outro banco. Pagamento pelo Asaas não precisa: ele baixa e concilia sozinho.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-ledger-muted">Valor pago (R$)<input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" className={inp} /></label>
            <label className="text-xs text-ledger-muted">Data do pagamento<DateField value={new Date(data + "T12:00:00")} onChange={(d) => d && setData(iso(d))} /></label>
          </div>
          <label className="block text-xs text-ledger-muted">Banco de destino<input value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ex.: Itaú, Nubank" className={inp} /></label>
          <label className="block text-xs text-ledger-muted">Arquivo (foto ou PDF, até 10 MB)
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setArq(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2" />
          </label>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Observação" className="w-full rounded-lg border border-line bg-surface p-2 text-sm" />
          <button disabled={salvando} onClick={salvar} className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{salvando ? "Enviando…" : "Anexar comprovante"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

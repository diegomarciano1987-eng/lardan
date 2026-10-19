import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DateField } from "@/components/premium/DateField";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { fetchFinAccounts } from "@/lib/financeiro";
import { useCapabilities } from "@/lib/capabilities";
import { brl, dataBR, hojeSP, alvarasJudiciais, liberarAlvaraJudicial, type AcordoJudicial } from "@/lib/cobranca";

export function AlvaraJudicial({ acordo }: { acordo: AcordoJudicial }) {
  const qc = useQueryClient();
  const caps = useCapabilities();
  const recebimentos = useQuery({ queryKey: ["cob", "alvaras", acordo.id], queryFn: () => alvarasJudiciais(acordo.id) });
  const [numero, setNumero] = React.useState<number | null>(null);
  const [conta, setConta] = React.useState("");
  const [dia, setDia] = React.useState(hojeSP());
  const [referencia, setReferencia] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState("");
  const contas = useQuery({ queryKey: ["fin-accounts"], queryFn: fetchFinAccounts, enabled: numero !== null });
  const itens = acordo.plano.filter((x) => !x.asaas || x.alvara);
  if (!itens.length) return null;
  const item = itens.find((x) => x.numero === numero);
  const salvar = async () => {
    if (!item || !conta || !dia || referencia.trim().length < 3) return;
    setSalvando(true); setErro("");
    try {
      await liberarAlvaraJudicial(acordo.id, item.numero, conta, dia, referencia.trim());
      await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^(cob$|fin($|-)|asaas($|-))/.test(q.queryKey[0]) });
      toast.success("Alvará registrado: dívida abatida e entrada lançada no Financeiro.");
      setNumero(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível registrar o alvará."); }
    finally { setSalvando(false); }
  };
  return <div className="mt-3 space-y-2 border-t border-line pt-3">
    {recebimentos.isError && <p role="alert" className="text-danger">Não foi possível conferir os alvarás registrados.</p>}
    {itens.map((x) => {
      const recebido = recebimentos.data?.find((r) => r.numero === x.numero && !r.estornado);
      return <div key={x.numero} className="flex flex-wrap items-center justify-between gap-3 py-2">
        <span className="flex items-center gap-2"><Landmark className="size-4 text-bronze" />{x.numero}ª · Alvará · {brl(x.valor_cents)} · {dataBR(x.data)}</span>
        {recebido ? <span className="flex items-center gap-2 text-success"><CheckCircle2 className="size-4" />Recebido em {dataBR(recebido.data)} · {recebido.conta}</span>
          : <Button variant="outline" disabled={!caps.includes("finance.settlement.create") || recebimentos.isPending || recebimentos.isError || acordo.status === "cancelado"} onClick={() => { setNumero(x.numero); setConta(""); setDia(hojeSP()); setReferencia(""); setErro(""); }}>Registrar liberação do alvará</Button>}
      </div>;
    })}
    <Dialog open={numero !== null} onOpenChange={(open) => { if (!open && !salvando) setNumero(null); }}>
      <DialogContent className="bg-surface text-ledger-text">
        <DialogHeader><DialogTitle>Registrar liberação do alvará</DialogTitle><DialogDescription>{item ? `${item.numero}ª parcela · ${brl(item.valor_cents)}` : "Alvará judicial"}</DialogDescription></DialogHeader>
        <label className="space-y-2 text-sm"><span>Conta que recebeu</span><SmartSelect value={conta} onChange={setConta} placeholder="Selecione a conta" options={(contas.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.nome }))} /></label>
        {contas.isError && <p role="alert" className="text-danger">Não foi possível carregar as contas.</p>}
        <label className="space-y-2 text-sm"><span>Data da entrada</span><DateField value={dia ? new Date(dia + "T12:00:00") : undefined} onChange={(d) => setDia(d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "")} /></label>
        <label className="space-y-2 text-sm"><span>Alvará / identificação do comprovante</span><input className="h-10 w-full rounded-lg border border-line bg-surface px-3" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
        {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
        <DialogFooter><Button variant="outline" disabled={salvando} onClick={() => setNumero(null)}>Cancelar</Button><Button disabled={salvando || !conta || !dia || referencia.trim().length < 3} onClick={() => void salvar()}>{salvando ? "Registrando…" : "Confirmar recebimento"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
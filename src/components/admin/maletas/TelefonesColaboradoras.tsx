import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";
import { fone } from "@/lib/pedido-consignacao";
import { toast } from "sonner";

type Linha = { user_id: string; nome: string; codigo: string | null; telefone: string | null; padrao: string };
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}
function Telefone({ linha, master }: { linha: Linha; master: boolean }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(linha.telefone ?? "");
  const m = useMutation({
    mutationFn: (telefone: string) => rpc("pedido_colaboradora_telefone_salvar", { _user: linha.user_id, _telefone: telefone }),
    onSuccess: (_, telefone) => { setValor(telefone); void qc.invalidateQueries({ queryKey: ["pedido-colaboradoras"] }); toast.success("Telefone de pedidos salvo."); },
    onError: (e) => toast.error(traduzir(e)),
  });
  return <section className="grid gap-3 border-b border-line-soft py-5 last:border-0">
    <div><h3 className="font-semibold text-ledger-text">{linha.nome}</h3><p className="text-sm text-ledger-muted">{linha.codigo ? `Login ${linha.codigo} · ` : ""}Na impressão: {fone(linha.telefone || linha.padrao) || "Sem telefone"}{linha.telefone ? "" : " · padrão"}</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="grid min-w-0 flex-1 gap-1 text-sm"><span>Telefone para pedidos</span><input aria-label={`Telefone para pedidos de ${linha.nome}`} className="admin-input" inputMode="tel" autoComplete="off" maxLength={24} disabled={!master || m.isPending} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
      {master && <><Button disabled={m.isPending || valor === (linha.telefone ?? "")} onClick={() => m.mutate(valor)}><Save />Salvar</Button><Button variant="outline" disabled={m.isPending || !linha.telefone} onClick={() => m.mutate("")}><RotateCcw />Usar padrão</Button></>}
    </div>
  </section>;
}
export function TelefonesColaboradoras({ master }: { master: boolean }) {
  const q = useQuery({ queryKey: ["pedido-colaboradoras"], queryFn: () => rpc<Linha[]>("pedido_colaboradoras_ler"), retry: false, staleTime: 0 });
  if (q.isError) return <p role="alert" className="text-destructive">{traduzir(q.error)}</p>;
  if (!q.data) return <p role="status">Carregando colaboradoras…</p>;
  return <div className="px-1"><h2 className="text-xl font-semibold text-ledger-text">Telefone de pedidos por colaboradora</h2>{q.data.length ? q.data.map((l) => <Telefone key={`${l.user_id}:${l.telefone ?? ""}`} linha={l} master={master} />) : <p className="py-6 text-ledger-muted">Sem colaboradoras cadastradas.</p>}</div>;
}
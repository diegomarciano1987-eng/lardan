import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ErrorState, Panel, Skeleton } from "@/components/admin/ui";

type Faixa = { id?: string; min_vendido_cents: number; percentual: number; titulo: string };
const t = () => supabase.from("consultora_comissao_faixas" as never);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const deReais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100) || 0;

/** Faixas de comissão de venda da consultora (sobre peças vendidas da própria maleta). */
export function ComissaoConsultora() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["comissao-consultora"],
    queryFn: async () => {
      const r = await t().select("*").order("min_vendido_cents");
      if (r.error) throw r.error;
      return r.data as unknown as Faixa[];
    },
  });
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  useEffect(() => { if (q.data) setFaixas(q.data); }, [q.data]);
  const muda = (i: number, p: Partial<Faixa>) => setFaixas((l) => l.map((f, k) => (k === i ? { ...f, ...p } : f)));

  const salvar = useMutation({
    mutationFn: async () => {
      const mins = faixas.map((f) => f.min_vendido_cents);
      if (new Set(mins).size !== mins.length) throw new Error("Duas faixas com o mesmo valor mínimo.");
      if (faixas.some((f) => f.min_vendido_cents < 0 || f.percentual < 0 || f.percentual > 80)) throw new Error("Confira: valor mínimo a partir de R$ 0,00 e percentual entre 0% e 80%.");
      const uid = (await supabase.auth.getUser()).data.user?.id;
      // Regrava a tabela inteira (auditada linha a linha) para nunca colidir no valor mínimo único.
      const antigas = (q.data ?? []).map((f) => f.id!).filter(Boolean);
      if (antigas.length) { const d = await t().delete().in("id", antigas); if (d.error) throw d.error; }
      if (faixas.length) {
        const r = await t().insert(faixas.map((f) => ({ min_vendido_cents: f.min_vendido_cents, percentual: f.percentual, titulo: f.titulo.trim(), updated_by: uid })) as never);
        if (r.error) throw r.error;
      }
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["comissao-consultora"] }); toast.success("Comissão salva. As consultoras já veem a nova tabela."); },
    onError: (e: Error) => { void qc.invalidateQueries({ queryKey: ["comissao-consultora"] }); toast.error(e.message); },
  });

  return (
    <Panel title="Configurações de comissão" action={<button type="button" className="admin-btn" onClick={() => setFaixas((l) => [...l, { min_vendido_cents: (l.at(-1)?.min_vendido_cents ?? 0) + 100000, percentual: 0, titulo: "" }])}><Plus className="size-4" /> Faixa</button>}>
      <div id="comissao" className="space-y-3">
        <p className="text-sm text-ledger-muted">Comissão da consultora sobre as peças <strong>vendidas e pagas</strong> da maleta. A faixa vale pelo total vendido no ciclo. A consultora consulta esta tabela no app e vê a estimativa em "Quanto eu ganho"; o acerto oficial continua no financeiro.</p>
        {q.isLoading ? <Skeleton className="h-24" /> : q.error ? <ErrorState message={String(q.error)} /> : (
          <>
            {faixas.length === 0 && <p className="rounded-xl border border-line-soft p-4 text-sm">Sem faixas cadastradas. Enquanto estiver vazio, o app da consultora mostra "Comissão ainda não configurada".</p>}
            {faixas.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase tracking-widest text-ledger-muted"><th className="py-2">Vendido a partir de (R$)</th><th>Comissão %</th><th>Nome da faixa</th><th /></tr></thead>
                <tbody>{faixas.map((f, i) => (
                  <tr key={f.id ?? `n${i}`} className="border-t border-line-soft">
                    <td className="py-2 pr-3"><input inputMode="decimal" className="admin-input w-36" defaultValue={reais(f.min_vendido_cents)} onBlur={(e) => muda(i, { min_vendido_cents: deReais(e.target.value) })} /></td>
                    <td className="pr-3"><input type="number" min={0} max={80} step={0.5} className="admin-input w-24" value={f.percentual} onChange={(e) => muda(i, { percentual: Number(e.target.value) })} /></td>
                    <td className="pr-3"><input className="admin-input" value={f.titulo} placeholder="Ex.: Bronze" onChange={(e) => muda(i, { titulo: e.target.value.slice(0, 40) })} /></td>
                    <td><button type="button" aria-label="Remover faixa" className="admin-btn" onClick={() => setFaixas((l) => l.filter((_, k) => k !== i))}><Trash2 className="size-4" /></button></td>
                  </tr>))}</tbody>
              </table>
            )}
            <button type="button" className="admin-btn admin-btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar comissão"}</button>
          </>
        )}
      </div>
    </Panel>
  );
}

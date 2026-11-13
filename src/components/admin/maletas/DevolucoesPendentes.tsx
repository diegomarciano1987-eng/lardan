/**
 * 0280 — maletas desta remessa que o representante (ou a equipe) mandou de volta para a empresa.
 * Ao chegar, a montagem confirma e as peças voltam ao estoque.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { devolucoesAbertas, receberDevolucao } from "@/lib/maleta-devolucao";

export function DevolucoesPendentes({ remessaNumero }: { remessaNumero: number }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["maletas", "devolucoes"], queryFn: () => devolucoesAbertas(null) });
  const receber = useMutation({
    mutationFn: (id: string) => receberDevolucao(id),
    onSuccess: (r) => {
      toast.success(`Maleta recebida: ${r.pecas} peças voltaram ao estoque.`);
      if (r.pendencia_fiscal) toast.info("A nota de devolução da maleta sai sozinha em alguns minutos.", { duration: 7000 });
      void qc.invalidateQueries({ queryKey: ["maletas"] });
      void qc.invalidateQueries({ queryKey: ["remessas"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const lista = (q.data ?? []).filter((d) => d.remessa === remessaNumero);
  if (lista.length === 0) return null;
  return (
    <Panel title={`Maletas voltando para a empresa (${lista.length})`}>
      <div className="space-y-3">
        {lista.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface p-4">
            <div className="min-w-64 flex-1">
              <p className="font-semibold text-ledger-text">
                <Link to="/admin/maletas/$id" params={{ id: d.cycle_id }} className="admin-link">{d.maleta}</Link> · {d.consultora ?? "abertura"} · {d.pecas} peças
              </p>
              <p className="text-xs text-ledger-muted">
                {d.origem === "representante" ? `Devolvida por ${d.representante ?? "representante"}` : "Registrada pela equipe"} em{" "}
                {new Date(d.pedido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {d.motivo}
              </p>
            </div>
            <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={receber.isPending}
              onClick={() => { if (window.confirm(`Confirmar que a maleta ${d.maleta} chegou? As peças voltam ao estoque.`)) receber.mutate(d.id); }}>
              Confirmar chegada
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

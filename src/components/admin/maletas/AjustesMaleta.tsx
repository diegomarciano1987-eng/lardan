import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";
import { TransferirForm } from "@/components/admin/maletas/TransferirMaleta";
import { traduzir } from "@/lib/maletas";

async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

/**
 * Transferir a maleta (0279: antes da nota ou já na rua, sem aceite) e, antes de sair, excluir
 * (as peças voltam ao depósito de origem). Tudo pelas operações oficiais e auditado.
 */
export function AjustesMaleta({ cycleId, status }: { cycleId: string; status: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [motivo, setMotivo] = React.useState("");
  const [confirmar, setConfirmar] = React.useState(false);

  const vinculo = useQuery({
    queryKey: ["maletas", "remessa-do-ciclo", cycleId],
    queryFn: async () => {
      const { data: c, error } = await supabase.from("kit_cycles").select("remessa_id").eq("id", cycleId).maybeSingle();
      if (error) throw error;
      if (!c?.remessa_id) return null;
      const { data: r, error: e2 } = await supabase.from("remessas").select("id,praca_id,numero").eq("id", c.remessa_id).maybeSingle();
      if (e2) throw e2;
      return r as { id: string; praca_id: string; numero: number } | null;
    },
  });
  const praca = vinculo.data?.praca_id ?? null;
  const podeExcluir = ["rascunho", "montagem", "conferida"].includes(status);

  const feito = () => {
    setMotivo(""); setConfirmar(false);
    void qc.invalidateQueries({ queryKey: ["maletas"] });
    void qc.invalidateQueries({ queryKey: ["remessas"] });
  };
  const exigirMotivo = () => { if (motivo.trim().length < 5) throw new Error("Escreva o motivo (mínimo 5 letras)."); };

  const excluir = useMutation({
    mutationFn: () => { exigirMotivo(); return rpc<{ pecas_devolvidas?: number }>("remessa_maleta_excluir", { _cycle: cycleId, _motivo: motivo.trim() }); },
    onSuccess: (r) => {
      toast.success(`Maleta excluída. ${r?.pecas_devolvidas ?? 0} peça(s) voltaram ao depósito.`);
      feito();
      if (vinculo.data) navigate({ to: "/admin/maletas/remessa/$id", params: { id: vinculo.data.id } });
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const ocupado = excluir.isPending;

  return (
    <Panel title="Transferir ou ajustar maleta">
      <div className="space-y-6">
        {vinculo.isLoading ? <p className="text-sm text-ledger-muted">Carregando…</p> : <TransferirForm cycleId={cycleId} pracaId={praca} />}

        {podeExcluir && (
          <div className="space-y-2 border-t border-line-soft pt-4">
            <label className="block space-y-1">
              <span className="text-sm font-semibold text-ledger-text">Excluir maleta (só antes de sair) — motivo</span>
              <input className="admin-input w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: maleta aberta por engano" />
            </label>
            {!confirmar ? (
              <button type="button" className="admin-btn w-full justify-center text-destructive" disabled={ocupado} onClick={() => setConfirmar(true)}>
                <Trash2 aria-hidden className="size-4" /> Excluir maleta
              </button>
            ) : (
              <div className="space-y-2 rounded-md border border-destructive/40 p-3">
                <p className="text-sm text-ledger-text">As peças já bipadas voltam ao depósito de origem e a maleta é cancelada. Confirmar?</p>
                <div className="flex gap-2">
                  <button type="button" className="admin-btn flex-1 justify-center" onClick={() => setConfirmar(false)}>Voltar</button>
                  <button type="button" className="admin-btn admin-btn-primary flex-1 justify-center" disabled={ocupado} onClick={() => excluir.mutate()}>
                    {excluir.isPending ? "Excluindo…" : "Sim, excluir"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

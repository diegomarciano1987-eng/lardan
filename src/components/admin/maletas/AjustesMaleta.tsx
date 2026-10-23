import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2, UserRound, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { consultorasDaPraca } from "@/lib/remessas";
import { traduzir } from "@/lib/maletas";

async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

/**
 * Antes de a maleta sair: trocar a consultora, deixar com o representante ou excluir
 * (as peças voltam ao depósito de origem). Tudo pelas operações oficiais e auditado.
 */
export function AjustesMaleta({ cycleId, consultoraId, representante }: { cycleId: string; consultoraId: string | null; representante: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busca, setBusca] = React.useState("");
  const [nova, setNova] = React.useState<string | undefined>(undefined);
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
  const praca = vinculo.data?.praca_id;
  const consultoras = useQuery({
    queryKey: ["remessas", "consultoras", praca, busca],
    queryFn: () => consultorasDaPraca(praca!, busca),
    enabled: !!praca,
  });
  const opcoes = (consultoras.data ?? []).filter((o) => o.value !== consultoraId);

  const feito = () => {
    setMotivo(""); setNova(undefined); setConfirmar(false);
    void qc.invalidateQueries({ queryKey: ["maletas"] });
    void qc.invalidateQueries({ queryKey: ["remessas"] });
  };
  const exigirMotivo = () => { if (motivo.trim().length < 5) throw new Error("Escreva o motivo (mínimo 5 letras)."); };

  const trocar = useMutation({
    mutationFn: (para: string | null) => { exigirMotivo(); return rpc("remessa_maleta_trocar_consultora", { _cycle: cycleId, _consultora: para, _motivo: motivo.trim() }); },
    onSuccess: (_r, para) => { toast.success(para ? "Consultora trocada." : "A maleta agora fica com o representante."); feito(); },
    onError: (e) => toast.error(traduzir(e)),
  });
  const excluir = useMutation({
    mutationFn: () => { exigirMotivo(); return rpc<{ pecas_devolvidas?: number }>("remessa_maleta_excluir", { _cycle: cycleId, _motivo: motivo.trim() }); },
    onSuccess: (r) => {
      toast.success(`Maleta excluída. ${r?.pecas_devolvidas ?? 0} peça(s) voltaram ao depósito.`);
      feito();
      if (vinculo.data) navigate({ to: "/admin/maletas/remessa/$id", params: { id: vinculo.data.id } });
    },
    onError: (e) => toast.error(traduzir(e)),
  });
  const ocupado = trocar.isPending || excluir.isPending;

  return (
    <Panel title="Ajustar maleta">
      <div className="space-y-4">
        <p className="text-sm text-ledger-muted">Só enquanto a maleta não saiu. Tudo fica registrado com o motivo.</p>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ledger-text">Motivo</span>
          <input className="admin-input w-full" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: consultora desistiu" />
        </label>

        {praca ? (
          <div className="space-y-2">
            <span className="text-sm font-semibold text-ledger-text">Trocar consultora</span>
            <SmartSelect value={nova} onChange={setNova} options={opcoes} onSearch={setBusca} loading={consultoras.isFetching}
              searchPlaceholder="Buscar por nome ou CPF" placeholder="Escolher outra consultora da praça" />
            <button type="button" className="admin-btn admin-btn-primary w-full justify-center" disabled={!nova || ocupado} onClick={() => trocar.mutate(nova ?? null)}>
              <UsersRound aria-hidden className="size-4" /> Trocar consultora
            </button>
          </div>
        ) : (
          <p className="text-sm text-ledger-muted">{vinculo.isLoading ? "Carregando…" : "Maleta fora de remessa: troca de consultora indisponível."}</p>
        )}

        {consultoraId && representante && (
          <button type="button" className="admin-btn w-full justify-center" disabled={ocupado} onClick={() => trocar.mutate(null)}>
            <UserRound aria-hidden className="size-4" /> Tirar a consultora (fica com {representante})
          </button>
        )}

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
    </Panel>
  );
}

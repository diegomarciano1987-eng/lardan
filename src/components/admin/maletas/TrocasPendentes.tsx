/**
 * 0274 — Maletas que o representante passou para uma abertura depois da nota fiscal já emitida
 * em nome da consultora original. A troca já valeu; a montagem faz a parte fiscal
 * (devolução da original + nota nova da abertura) e marca aqui como resolvida.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";

interface Pendencia {
  id: string;
  cycle_id: string;
  maleta: string | null;
  consultora_anterior_nome: string | null;
  consultora_nova_nome: string | null;
  nota_numero: string | null;
  criado_em: string;
}

export function TrocasPendentes({ remessaId, podeResolver }: { remessaId: string; podeResolver: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["remessas", "trocas-pendentes", remessaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maleta_troca_pendencias" as never)
        .select("id, cycle_id, maleta, consultora_anterior_nome, consultora_nova_nome, nota_numero, criado_em")
        .eq("remessa_id", remessaId)
        .eq("status", "aberta")
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as unknown as Pendencia[];
    },
  });
  const [obs, setObs] = React.useState<Record<string, string>>({});
  const resolver = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("maleta_troca_pendencia_resolver" as never, { _id: id, _obs: obs[id] || null } as never);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success("Pendência marcada como resolvida."); void qc.invalidateQueries({ queryKey: ["remessas", "trocas-pendentes", remessaId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <Panel title={`Maletas trocadas pelo representante — nota fiscal a resolver (${lista.length})`}>
      <p className="mb-4 max-w-3xl text-sm text-ledger-muted">
        O representante passou estas maletas para uma abertura depois que a nota de remessa já tinha saído em nome de outra consultora.
        Faça a nota de devolução da consultora original e a nota nova da abertura; depois marque como resolvida.
      </p>
      <div className="space-y-3">
        {lista.map((p) => (
          <div key={p.id} className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line-soft bg-surface p-4">
            <div className="min-w-64 flex-1">
              <p className="font-semibold text-ledger-text">{p.maleta ?? "Maleta"}: {p.consultora_anterior_nome ?? "—"} → {p.consultora_nova_nome ?? "—"}</p>
              <p className="text-xs text-ledger-muted">
                Nota de remessa nº {p.nota_numero ?? "sem número"} em nome de {p.consultora_anterior_nome ?? "—"} · trocada em {new Date(p.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </p>
            </div>
            {podeResolver && (
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input h-9 w-64 text-sm" placeholder="Observação (nº das notas novas)" value={obs[p.id] ?? ""}
                  onChange={(e) => setObs((o) => ({ ...o, [p.id]: e.target.value }))} />
                <button type="button" className="admin-btn admin-btn-primary h-9 px-3 text-xs" disabled={resolver.isPending}
                  onClick={() => { if (window.confirm("Confirmar que as notas desta troca já foram feitas?")) resolver.mutate(p.id); }}>
                  Marcar como resolvida
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

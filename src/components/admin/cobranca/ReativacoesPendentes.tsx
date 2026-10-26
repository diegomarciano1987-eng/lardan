/**
 * 0160 — Pedidos de reativação de consultora COM dívida, feitos pelo representante.
 * Sem dívida o representante reativa na hora; com dívida só o Master aprova (fica registrado).
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminRoles } from "@/components/admin/AdminShell";

type Pedido = { id: string; party_id: string; consultora: string; code: string | null; representante: string | null; motivo: string | null; divida_cents: number; divida_hoje_cents: number; em: string };
const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ReativacoesPendentes() {
  const roles = useAdminRoles();
  const master = roles.includes("master" as never);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["cob", "reativacoes"],
    queryFn: async () => { const { data, error } = await supabase.rpc("rep_reativacoes_pendentes" as never); if (error) throw error; return data as unknown as Pedido[]; },
    retry: false,
  });
  const [motivo, setMotivo] = React.useState<Record<string, string>>({});
  const decidir = useMutation({
    mutationFn: async (v: { id: string; aprovar: boolean }) => {
      const { error } = await supabase.rpc("rep_reativacao_decidir" as never, { _id: v.id, _aprovar: v.aprovar, _motivo: motivo[v.id] ?? null } as never);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { toast.success(v.aprovar ? "Consultora reativada." : "Pedido recusado."); void qc.invalidateQueries({ queryKey: ["cob"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  return (
    <section className="space-y-3 rounded-xl border border-warning/50 bg-warning/5 p-4">
      <p className="flex items-center gap-2 font-semibold"><UserCheck className="size-4" /> {lista.length} pedido(s) de reativação com dívida</p>
      <ul className="space-y-2 text-sm">
        {lista.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium">{p.consultora}{p.code ? ` · ${p.code}` : ""}</p>
              <p className="text-xs text-muted-foreground">Pedido por {p.representante ?? "representante"} em {new Date(p.em).toLocaleDateString("pt-BR")} · dívida hoje {brl(p.divida_hoje_cents)}{p.motivo ? ` · “${p.motivo}”` : ""}</p>
            </div>
            {master ? (
              <div className="flex flex-wrap items-center gap-2">
                <input className="admin-input h-9 w-56" placeholder="Motivo da decisão (opcional)" value={motivo[p.id] ?? ""} onChange={(e) => setMotivo({ ...motivo, [p.id]: e.target.value })} />
                <button type="button" className="admin-btn" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, aprovar: false })}>Recusar</button>
                <button type="button" className="admin-btn admin-btn-primary" disabled={decidir.isPending} onClick={() => decidir.mutate({ id: p.id, aprovar: true })}>Aprovar e reativar</button>
              </div>
            ) : <span className="text-xs text-muted-foreground">Aguardando o Master</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

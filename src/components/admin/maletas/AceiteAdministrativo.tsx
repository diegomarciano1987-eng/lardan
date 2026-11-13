/**
 * 0325 — só o Master: registrar que a consultora JÁ ACEITOU a maleta (entrega presencial conferida).
 * Usa kit_aceite_administrativo (custódia e aceite pelos motores oficiais, peças integrais, motivo e auditoria).
 * Depois disso a maleta aparece em operação no app dela assim que ela tiver acesso.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/ui";

type Pendente = { cycle_id: string; codigo: string; situacao: string; consultora: string; consultora_codigo: string | null; com_quem: string | null; tem_login: boolean; pecas: number };

export function AceiteAdministrativo({ remessaId }: { remessaId: string }) {
  const qc = useQueryClient();
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [motivo, setMotivo] = React.useState("");
  const q = useQuery({
    queryKey: ["remessa", remessaId, "aceites-pendentes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("remessa_aceites_pendentes" as never, { _remessa: remessaId } as never);
      if (error) throw error;
      return (data ?? []) as unknown as Pendente[];
    },
  });
  const aplicar = useMutation({
    mutationFn: async () => {
      const res: { codigo: string; ok: boolean; erro?: string }[] = [];
      for (const m of (q.data ?? []).filter((x) => sel.has(x.cycle_id))) {
        const { error } = await supabase.rpc("kit_aceite_administrativo" as never, { _cycle: m.cycle_id, _motivo: motivo.trim() } as never);
        res.push({ codigo: m.codigo, ok: !error, erro: error?.message });
      }
      return res;
    },
    onSuccess: (res) => {
      const ok = res.filter((r) => r.ok).length;
      if (ok) toast.success(`${ok} maleta(s) marcadas como aceitas pela consultora.`);
      res.filter((r) => !r.ok).forEach((r) => toast.error(`${r.codigo}: ${r.erro}`));
      setSel(new Set());
      setMotivo("");
      void qc.invalidateQueries({ queryKey: ["remessa", remessaId] });
      void qc.invalidateQueries();
    },
  });
  const lista = q.data ?? [];
  if (!q.isSuccess || lista.length === 0) return null;
  const todas = sel.size === lista.length;
  return (
    <Panel title="Consultora já aceitou (somente Master)">
      <p className="text-sm text-muted-foreground">
        Maletas que já estão com a consultora mas não têm aceite no app. Marque as que ela aceitou de verdade.
        A maleta passa para "em operação" e aparece pronta no app dela, sem pedir a conferência de novo. Fica registrado com o seu nome e o motivo.
      </p>
      <div className="mt-3 divide-y divide-line-soft rounded-xl border border-line-soft">
        <label className="flex items-center gap-3 px-4 py-2 text-sm font-semibold">
          <input type="checkbox" checked={todas} onChange={() => setSel(todas ? new Set() : new Set(lista.map((m) => m.cycle_id)))} aria-label="Marcar todas" />
          Marcar todas ({lista.length})
        </label>
        {lista.map((m) => (
          <label key={m.cycle_id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <input type="checkbox" checked={sel.has(m.cycle_id)} aria-label={`Aceite ${m.codigo}`}
              onChange={() => setSel((s) => { const n = new Set(s); if (n.has(m.cycle_id)) n.delete(m.cycle_id); else n.add(m.cycle_id); return n; })} />
            <span className="font-mono">{m.codigo}</span>
            <span className="flex-1">{m.consultora_codigo ? `[Cód. ${m.consultora_codigo}] ` : ""}{m.consultora}</span>
            <span className="text-muted-foreground">{m.pecas} peças · com {m.com_quem ?? "—"} · {m.tem_login ? "tem acesso ao app" : "ainda sem acesso"}</span>
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium" htmlFor="motivo-aceite-adm">Motivo (obrigatório)</label>
      <textarea id="motivo-aceite-adm" className="admin-input mt-1 w-full" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: maleta entregue e conferida em mãos pelo representante" />
      <button type="button" className="admin-btn admin-btn-primary mt-3 inline-flex items-center gap-2"
        disabled={aplicar.isPending || sel.size === 0 || motivo.trim().length < 5} onClick={() => aplicar.mutate()}>
        <CheckCircle2 className="h-4 w-4" /> {aplicar.isPending ? "Registrando…" : `Registrar aceite de ${sel.size} maleta(s)`}
      </button>
    </Panel>
  );
}

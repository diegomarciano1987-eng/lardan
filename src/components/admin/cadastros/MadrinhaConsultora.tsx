/** 0159 — "Indicada por" na ficha da consultora: mostra a madrinha (link ou formulário) e deixa corrigir. */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";

type Madrinha = { madrinha_id: string | null; madrinha: string | null; origem: string | null; em: string | null; texto_formulario: string | null };

export function MadrinhaConsultora({ partyId, podeEditar }: { partyId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["madrinha", partyId], queryFn: async () => {
    const { data, error } = await supabase.rpc("consultora_madrinha_ler" as never, { _party: partyId } as never); if (error) throw error; return data as unknown as Madrinha | null;
  } });
  const [busca, setBusca] = React.useState("");
  const [nova, setNova] = React.useState("");
  const opcoes = useQuery({ queryKey: ["madrinha-busca", busca], enabled: podeEditar && busca.trim().length >= 2, queryFn: async () => {
    const { data, error } = await supabase.rpc("list_parties", { _search: busca, _role: "consultora", _limit: 20 } as never);
    if (error) throw error;
    return ((data ?? []) as unknown as { id: string; display_name: string; code: string | null }[]).filter((p) => p.id !== partyId)
      .map((p) => ({ value: p.id, label: p.display_name, hint: p.code ?? "" }));
  } });
  const salvar = useMutation({
    mutationFn: async (id: string | null) => { const { error } = await supabase.rpc("consultora_madrinha_definir" as never, { _party: partyId, _madrinha: id } as never); if (error) throw error; },
    onSuccess: () => { toast.success("Madrinha salva."); setNova(""); void qc.invalidateQueries({ queryKey: ["madrinha", partyId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const d = q.data;
  return (
    <div className="space-y-2 text-sm md:col-span-2">
      <span className="ledger-eyebrow">Indicada por</span>
      <p className="text-ledger-text">
        {d?.madrinha ? <strong>{d.madrinha}</strong> : "Sem madrinha registrada"}
        {d?.origem ? <span className="text-ledger-muted"> · {d.origem === "link" ? "pelo link de indicação" : d.origem === "manual" ? "ajustada na ficha" : d.origem}</span> : null}
        {d?.texto_formulario ? <span className="block text-ledger-muted">No formulário ela escreveu: “{d.texto_formulario}”</span> : null}
      </p>
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-64 flex-1">
            <SmartSelect options={opcoes.data ?? []} value={nova} onChange={setNova} onSearch={setBusca} placeholder="Buscar a consultora que indicou" emptyLabel="Digite 2 letras do nome" />
          </div>
          <button type="button" className="admin-btn" disabled={!nova || salvar.isPending} onClick={() => salvar.mutate(nova)}>Salvar madrinha</button>
          {d?.madrinha_id && <button type="button" className="admin-btn" disabled={salvar.isPending} onClick={() => salvar.mutate(null)}>Tirar</button>}
        </div>
      )}
    </div>
  );
}

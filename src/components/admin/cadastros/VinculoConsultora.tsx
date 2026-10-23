import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { Panel } from "@/components/admin/ui";

/** Vínculo da consultora: representante responsável e praça (consultant_profiles). */
export function VinculoConsultora({ partyId, podeEditar }: { partyId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["vinculo-consultora", partyId],
    queryFn: async () => {
      const [perfil, reps, pracas] = await Promise.all([
        supabase.from("consultant_profiles").select("representative_party_id,praca_id").eq("party_id", partyId).maybeSingle(),
        supabase.from("party_roles").select("party_id, parties!inner(id,display_name,code)").eq("role", "representante").eq("status", "ativo"),
        supabase.from("cob_pracas").select("id,codigo,nome").eq("ativo", true).order("codigo"),
      ]);
      if (perfil.error) throw perfil.error;
      type Rep = { party_id: string; parties: { display_name: string | null; code: string | null } };
      return {
        rep: perfil.data?.representative_party_id ?? "",
        praca: perfil.data?.praca_id ?? "",
        reps: ((reps.data ?? []) as unknown as Rep[]).map((r) => ({
          value: r.party_id, label: r.parties.display_name ?? "Representante", hint: r.parties.code ?? "",
        })),
        pracas: (pracas.data ?? []).map((p) => ({ value: p.id, label: `${p.codigo} — ${p.nome}` })),
      };
    },
  });
  const [rep, setRep] = useState("");
  const [praca, setPraca] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (q.data) { setRep(q.data.rep); setPraca(q.data.praca); }
  }, [q.data]);

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from("consultant_profiles").upsert(
      { party_id: partyId, representative_party_id: rep || null, praca_id: praca || null },
      { onConflict: "party_id" },
    );
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar o vínculo.", { description: error.message });
      return;
    }
    toast.success("Vínculo da consultora salvo.");
    await qc.invalidateQueries({ queryKey: ["vinculo-consultora", partyId] });
    await qc.invalidateQueries({ queryKey: ["party", partyId] });
  }

  return (
    <Panel title="Vínculo da consultora" flush className="mb-4">
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          <span className="ledger-eyebrow">Representante responsável</span>
          <SmartSelect options={q.data?.reps ?? []} value={rep} onChange={setRep} disabled={!podeEditar}
            placeholder="Sem representante" emptyLabel="Nenhum representante ativo" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span className="ledger-eyebrow">Praça</span>
          <SmartSelect options={q.data?.pracas ?? []} value={praca} onChange={setPraca} disabled={!podeEditar}
            placeholder="Sem praça" emptyLabel="Nenhuma praça ativa" />
        </label>
        {podeEditar && (
          <div className="flex gap-2 md:col-span-2">
            <button type="button" className="admin-btn-primary" disabled={salvando} onClick={salvar}>
              {salvando ? "Salvando…" : "Salvar vínculo"}
            </button>
            {(rep || praca) && (
              <button type="button" className="admin-btn-secondary" onClick={() => { setRep(""); setPraca(""); }}>
                Limpar
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

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
  // Praças vêm do histórico do representante: uma só é preenchida sozinha.
  const pracasRep = useQuery({
    queryKey: ["rep-pracas", rep, partyId],
    enabled: !!rep,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_pracas_vinculo" as never, { _rep: rep, _consultora: partyId } as never);
      if (error) throw error;
      const d = data as unknown as { pracas: { id: string; codigo: number; nome: string }[]; sugestao: string | null };
      return { opcoes: d.pracas.map((p) => ({ value: p.id, label: `${p.codigo} — ${p.nome}` })), sugestao: d.sugestao };
    },
  });
  useEffect(() => {
    const r = pracasRep.data;
    if (!r || r.opcoes.length === 0) return;
    if (r.opcoes.some((o) => o.value === praca)) return;
    if (r.opcoes.length === 1) setPraca(r.opcoes[0]!.value);
    else if (r.sugestao) setPraca(r.sugestao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pracasRep.data]);
  const opcoesPraca = pracasRep.data?.opcoes.length ? pracasRep.data.opcoes : q.data?.pracas ?? [];
  const pracaUnica = pracasRep.data?.opcoes.length === 1;
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
          <SmartSelect options={q.data?.reps ?? []} value={rep} onChange={(v) => { setRep(v); setPraca(""); }} disabled={!podeEditar}
            placeholder="Sem representante" emptyLabel="Nenhum representante ativo" />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span className="ledger-eyebrow">Praça</span>
          {pracaUnica ? (
            <p className="flex h-11 items-center rounded-lg border border-line-soft bg-surface-muted px-3 text-sm text-ledger-text">
              {opcoesPraca[0]!.label}
            </p>
          ) : (
            <SmartSelect options={opcoesPraca} value={praca} onChange={setPraca} disabled={!podeEditar}
              placeholder={rep ? "Escolha entre as praças do representante" : "Escolha o representante primeiro"}
              emptyLabel="Nenhuma praça ativa" />
          )}
          <span className="block text-xs text-ledger-muted">
            {!rep ? "A praça vem do representante escolhido."
              : pracasRep.isLoading ? "Buscando as praças do representante…"
              : pracaUnica ? "Preenchida pelo histórico do representante."
              : pracasRep.data?.opcoes.length ? `Este representante atende ${pracasRep.data.opcoes.length} praças${pracasRep.data.sugestao ? "; já marquei a do histórico da consultora" : ""}.`
              : "Representante sem praça no histórico; escolha na lista."}
          </span>
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

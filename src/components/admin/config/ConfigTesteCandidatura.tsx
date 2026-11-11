/**
 * 0284 — parâmetros do teste de candidatura (o Daniel calibra depois do piloto).
 * Cada gravação cria uma NOVA versão (versao_teste); as análises antigas guardam a versão em que foram calculadas.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { mesclarParametros, type ParametrosTeste } from "@/lib/candidatura-teste/padrao";

const ROTULO: Record<string, string> = {
  experiencia_venda: "R4 Já vende", horas_semana: "R6 Horas por semana", contatos_semana: "R1 Contatos por semana", publico_feminino: "R2 Público feminino",
  contatos_whatsapp: "R5 Contatos no WhatsApp", o1: "O1 Controle de gastos", o2: "O2 Pagar depois", o3: "O3 Contas em dia", o4: "O4 Dia do acerto", o5: "O5 Dinheiro das vendas",
  rp_alta: "Rede alta a partir de", rp_media: "Rede média a partir de", av_alta: "Aptidão alta a partir de", av_media: "Aptidão média a partir de",
  ioa_alto: "Risco alto abaixo de", ioa_medio: "Risco médio abaixo de", av_disc: "AV: peso do I", av_iniciativa: "AV: peso da iniciativa",
  ioa_o: "IOA: peso das situações", ioa_disciplina: "IOA: peso da disciplina", ioa_cs: "IOA: peso de C+S", ipl_rp: "IPL: peso da rede", ipl_av: "IPL: peso da aptidão",
  disc_rapido_s: "Rápido demais (segundos)", disc_plano: "Perfil plano (±)", vitrine_id: "Vitrine: I+D ≥", vitrine_c: "Vitrine: C ≤", fiado_i: "Fiado: I ≥", fiado_c: "Fiado: C ≤", anota_c: "Anota incoerente: C ≤",
};

function Num({ rotulo, valor, onChange }: { rotulo: string; valor: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-ledger-muted">{rotulo}</span>
      <input className="admin-input w-full" inputMode="decimal" value={String(valor)} onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (!Number.isNaN(v)) onChange(v); }} />
    </label>
  );
}

export function ConfigTesteCandidatura({ master }: { master: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["candidatura-teste", "config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("candidatura_teste_config").select("versao, params, criado_em").order("criado_em", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return { atual: mesclarParametros((data?.params ?? null) as Partial<ParametrosTeste> | null), em: data?.criado_em ?? null };
    },
  });
  const [p, setP] = React.useState<ParametrosTeste | null>(null);
  React.useEffect(() => { if (q.data && !p) setP(q.data.atual); }, [q.data, p]);
  const salvar = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const agora = new Date();
      const versao = `${agora.toISOString().slice(0, 10)}-${agora.toISOString().slice(11, 16).replace(":", "")}`;
      const { error } = await supabase.from("candidatura_teste_config").insert({ versao, params: { ...p!, versao } as never, criado_por: u.user!.id });
      if (error) throw error;
      return versao;
    },
    onSuccess: (v) => { toast.success(`Nova versão do teste gravada: ${v}.`); setP(null); void qc.invalidateQueries({ queryKey: ["candidatura-teste", "config"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!p) return <Panel title="Teste de candidatura"><p className="text-sm text-ledger-muted">Carregando…</p></Panel>;
  const grupo = <K extends "faixas" | "pesos" | "alertas">(k: K) => (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Object.entries(p[k]).map(([c, v]) => <Num key={c} rotulo={ROTULO[c] ?? c} valor={v as number} onChange={(n) => setP({ ...p, [k]: { ...p[k], [c]: n } })} />)}
    </div>
  );
  return (
    <Panel title="Teste de candidatura — parâmetros">
      <div className="space-y-6 text-sm">
        <p className="text-ledger-muted">Versão atual: <strong className="text-ledger-text">{p.versao}</strong>. Gravar cria uma versão nova; as análises já feitas guardam a versão delas. {master ? "" : "Somente o Master grava."}</p>
        <details className="rounded-xl border border-line-soft p-4" open>
          <summary className="cursor-pointer font-semibold text-ledger-text">Pontos de cada resposta</summary>
          <div className="mt-3 space-y-4">
            {Object.entries(p.pontos).map(([campo, ops]) => (
              <div key={campo}>
                <p className="mb-1 text-xs font-semibold text-ledger-text">{ROTULO[campo] ?? campo}</p>
                <div className="grid gap-2 sm:grid-cols-4">
                  {Object.entries(ops).map(([c, v]) => <Num key={c} rotulo={c} valor={v} onChange={(n) => setP({ ...p, pontos: { ...p.pontos, [campo]: { ...ops, [c]: n } } })} />)}
                </div>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-4">
              <Num rotulo="R3 pontos por lugar" valor={p.onde_por_item} onChange={(n) => setP({ ...p, onde_por_item: n })} />
              <Num rotulo="R3 máximo" valor={p.onde_max} onChange={(n) => setP({ ...p, onde_max: n })} />
              <Num rotulo="Ajuste da rede (+)" valor={p.ajuste_rp} onChange={(n) => setP({ ...p, ajuste_rp: n })} />
              <Num rotulo="Validade do link (dias)" valor={p.validade_dias} onChange={(n) => setP({ ...p, validade_dias: Math.max(1, Math.round(n)) })} />
            </div>
          </div>
        </details>
        <div><p className="ledger-eyebrow mb-2">Faixas</p>{grupo("faixas")}</div>
        <div><p className="ledger-eyebrow mb-2">Pesos</p>{grupo("pesos")}</div>
        <div><p className="ledger-eyebrow mb-2">Limites dos alertas</p>{grupo("alertas")}</div>
        <details className="rounded-xl border border-line-soft p-4">
          <summary className="cursor-pointer font-semibold text-ledger-text">Textos por perfil (devolutiva para a candidata, entrevista e acompanhamento)</summary>
          <p className="mt-2 text-xs text-ledger-muted">Cole os textos dos quadros DEVOLUTIVA, ENTREVISTA e ACOMP do protótipo. Vazio = não aparece.</p>
          {(["devolutiva", "entrevista", "acompanhamento"] as const).map((t) => (
            <div key={t} className="mt-4 grid gap-3 md:grid-cols-2">
              {["D", "I", "S", "C"].map((f) => (
                <label key={f} className="grid gap-1 text-xs">
                  <span className="text-ledger-muted">{t} · {f}</span>
                  <textarea rows={3} className="admin-input w-full" value={p.textos[t][f] ?? ""} onChange={(e) => setP({ ...p, textos: { ...p.textos, [t]: { ...p.textos[t], [f]: e.target.value } } })} />
                </label>
              ))}
            </div>
          ))}
        </details>
        {master && <button type="button" className="admin-btn admin-btn-primary" disabled={salvar.isPending} onClick={() => { if (window.confirm("Gravar uma nova versão dos parâmetros do teste?")) salvar.mutate(); }}>Gravar nova versão</button>}
      </div>
    </Panel>
  );
}

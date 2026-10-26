/**
 * 0159 — Configurações: critérios do "Caminho para líder", aprovação das líderes, comissão da líder
 * (desligada por enquanto) e os níveis da Liga Lardan. Só o Master altera.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Panel } from "@/components/admin/ui";
import { supabase } from "@/integrations/supabase/client";
import { traduzir } from "@/lib/maletas";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}
type Admin = { config: { indicadas_ativas_min: number; venda_ciclo_min_cents: number; comissao_pct: number; comissao_ativa: boolean };
  lideres: { party_id: string; nome: string; status: string; solicitado_em: string; indicadas_ativas: number; motivo: string | null }[] };
type Nivel = { ordem: number; nome: string; ciclos_min: number; venda_min_cents: number };
const reais = (c: number) => (Number(c) / 100).toFixed(2).replace(".", ",");
const cents = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100) || 0;

export function LiderELiga({ master }: { master: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lider-admin"], queryFn: () => rpc<Admin>("lider_admin"), retry: false });
  const niveis = useQuery({ queryKey: ["liga-niveis"], queryFn: () => rpc<Nivel[]>("liga_niveis_ler") });
  const [cfg, setCfg] = React.useState({ indicadas: "3", venda: "650,00", pct: "0", ativa: false });
  const [lista, setLista] = React.useState<{ ordem: number; nome: string; ciclos: string; venda: string }[]>([]);
  React.useEffect(() => { if (q.data) setCfg({ indicadas: String(q.data.config.indicadas_ativas_min), venda: reais(q.data.config.venda_ciclo_min_cents), pct: String(q.data.config.comissao_pct), ativa: q.data.config.comissao_ativa }); }, [q.data]);
  React.useEffect(() => { if (niveis.data) setLista(niveis.data.map((n) => ({ ordem: n.ordem, nome: n.nome, ciclos: String(n.ciclos_min), venda: reais(n.venda_min_cents) }))); }, [niveis.data]);
  const ok = (t: string) => () => { toast.success(t); void qc.invalidateQueries({ queryKey: ["lider-admin"] }); void qc.invalidateQueries({ queryKey: ["liga-niveis"] }); };
  const salvarCfg = useMutation({ mutationFn: () => rpc("lider_config_salvar", { _indicadas: Number(cfg.indicadas), _venda_cents: cents(cfg.venda), _comissao_pct: Number(cfg.pct.replace(",", ".")), _comissao_ativa: cfg.ativa }), onSuccess: ok("Critérios de líder salvos."), onError: (e) => toast.error(traduzir(e)) });
  const decidir = useMutation({ mutationFn: (v: { party: string; status: string }) => rpc("lider_decidir", { _party: v.party, _status: v.status, _motivo: null }), onSuccess: ok("Decisão registrada."), onError: (e) => toast.error(traduzir(e)) });
  const salvarLiga = useMutation({ mutationFn: () => rpc("liga_niveis_salvar", { _niveis: lista.map((n, i) => ({ ordem: i + 1, nome: n.nome, ciclos_min: Number(n.ciclos), venda_min_cents: cents(n.venda) })) }), onSuccess: ok("Níveis da Liga salvos."), onError: (e) => toast.error(traduzir(e)) });
  if (q.isError) return null;
  return (
    <Panel title="Líderes e Liga Lardan">
      <div className="space-y-6 text-sm">
        <section className="space-y-3">
          <p className="font-semibold text-ledger-text">Caminho para líder</p>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="grid gap-1"><span className="ledger-eyebrow">Indicadas ativas mínimas</span><input className="admin-input" disabled={!master} inputMode="numeric" value={cfg.indicadas} onChange={(e) => setCfg({ ...cfg, indicadas: e.target.value.replace(/\D/g, "") })} /></label>
            <label className="grid gap-1"><span className="ledger-eyebrow">Venda mínima no ciclo (R$)</span><input className="admin-input" disabled={!master} value={cfg.venda} onChange={(e) => setCfg({ ...cfg, venda: e.target.value })} /></label>
            <label className="grid gap-1"><span className="ledger-eyebrow">Comissão da líder (%)</span><input className="admin-input" disabled={!master} value={cfg.pct} onChange={(e) => setCfg({ ...cfg, pct: e.target.value })} /></label>
            <label className="flex items-end gap-2 pb-2"><input type="checkbox" disabled={!master} checked={cfg.ativa} onChange={(e) => setCfg({ ...cfg, ativa: e.target.checked })} /> Comissão da líder ligada</label>
          </div>
          <p className="text-ledger-muted">Indicada ativa = cadastro ativo e maleta nos últimos 90 dias. A comissão da líder fica só guardada enquanto estiver desligada.</p>
          {master && <button type="button" className="admin-btn" disabled={salvarCfg.isPending} onClick={() => salvarCfg.mutate()}>Salvar critérios</button>}
        </section>

        <section className="space-y-2">
          <p className="font-semibold text-ledger-text">Pedidos para virar líder</p>
          {(q.data?.lideres ?? []).length === 0 ? <p className="text-ledger-muted">Nenhum pedido ainda.</p> : (
            <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
              {q.data!.lideres.map((l) => (
                <li key={l.party_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span><strong>{l.nome}</strong> · {l.indicadas_ativas} indicadas ativas · {l.status}</span>
                  {master && (
                    <span className="flex gap-2">
                      {l.status !== "aprovado" && <button type="button" className="admin-btn" onClick={() => decidir.mutate({ party: l.party_id, status: "aprovado" })}>Aprovar</button>}
                      {l.status === "solicitado" && <button type="button" className="admin-btn" onClick={() => decidir.mutate({ party: l.party_id, status: "recusado" })}>Recusar</button>}
                      {l.status === "aprovado" && <button type="button" className="admin-btn" onClick={() => decidir.mutate({ party: l.party_id, status: "suspenso" })}>Suspender</button>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <p className="font-semibold text-ledger-text">Níveis da Liga (ciclos nos últimos 12 meses com venda acima do mínimo)</p>
          {lista.map((n, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1fr_8rem_10rem_auto]">
              <input className="admin-input" disabled={!master} value={n.nome} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
              <input className="admin-input" disabled={!master} inputMode="numeric" value={n.ciclos} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, ciclos: e.target.value.replace(/\D/g, "") } : x)))} aria-label="Ciclos" />
              <input className="admin-input" disabled={!master} value={n.venda} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, venda: e.target.value } : x)))} aria-label="Venda mínima" />
              {master && <button type="button" className="admin-btn" onClick={() => setLista(lista.filter((_, j) => j !== i))}>Tirar</button>}
            </div>
          ))}
          {master && (
            <div className="flex gap-2">
              <button type="button" className="admin-btn" onClick={() => setLista([...lista, { ordem: lista.length + 1, nome: "", ciclos: "0", venda: "650,00" }])}>Nível</button>
              <button type="button" className="admin-btn admin-btn-primary" disabled={salvarLiga.isPending} onClick={() => salvarLiga.mutate()}>Salvar a Liga</button>
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}

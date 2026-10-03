import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ErrorState, PageHeader, Panel, Skeleton } from "@/components/admin/ui";
import { brl } from "@/lib/maletas";

export const Route = createFileRoute("/_authenticated/admin/candidaturas_/indicacao")({
  head: () => ({ meta: [{ title: "Configuração de indicação · Lardan" }, { name: "robots", content: "noindex" }] }),
  component: ConfigIndicacao,
});

type Faixa = { id?: string; min_indicadas: number; percentual: number; titulo: string };
type Painel = {
  rede: { party_id: string; nome: string; codigo: string; aprovadas: number; candidaturas: number; madrinha: string | null; comissao_cents: number }[];
  comissoes: { id: string; em: string; madrinha: string; indicada: string; venda_cents: number; pecas: number; aprovadas: number; percentual: number; faixa: string; comissao_cents: number; status: string; itens: { produto: string; qtd: number; preco_cents: number; total_cents: number }[] }[];
};
const t = (n: string) => supabase.from(n as never);

function ConfigIndicacao() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["indicacao", "config"],
    queryFn: async () => {
      const [s, f] = await Promise.all([t("referral_settings").select("*").eq("id", 1).single(), t("referral_tiers").select("*").order("min_indicadas")]);
      if (s.error) throw s.error;
      if (f.error) throw f.error;
      return { ativo: (s.data as { ativo: boolean }).ativo, faixas: f.data as unknown as Faixa[] };
    },
  });
  const painel = useQuery({
    queryKey: ["indicacao", "painel"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("indicacao_painel_admin" as never);
      if (error) throw error;
      return data as unknown as Painel;
    },
  });
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [ativo, setAtivo] = useState(true);
  useEffect(() => { if (cfg.data) { setFaixas(cfg.data.faixas); setAtivo(cfg.data.ativo); } }, [cfg.data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const mins = faixas.map((f) => f.min_indicadas);
      if (new Set(mins).size !== mins.length) throw new Error("Duas faixas com o mesmo número de indicadas.");
      if (faixas.some((f) => f.min_indicadas < 1 || f.percentual < 0 || f.percentual > 50)) throw new Error("Confira: mínimo 1 indicada e percentual entre 0% e 50%.");
      const { userId } = { userId: (await supabase.auth.getUser()).data.user?.id };
      const s = await t("referral_settings").update({ ativo, updated_at: new Date().toISOString(), updated_by: userId } as never).eq("id", 1);
      if (s.error) throw s.error;
      const antigos = (cfg.data?.faixas ?? []).map((f) => f.id).filter((id) => !faixas.some((f) => f.id === id));
      if (antigos.length) { const d = await t("referral_tiers").delete().in("id", antigos as string[]); if (d.error) throw d.error; }
      // grava em duas fases para não colidir no número mínimo único
      for (const f of faixas.filter((x) => x.id)) {
        const u = await t("referral_tiers").update({ min_indicadas: -0 + 100000 + f.min_indicadas } as never).eq("id", f.id!);
        if (u.error) throw u.error;
      }
      for (const f of faixas) {
        const linha = { min_indicadas: f.min_indicadas, percentual: f.percentual, titulo: f.titulo.trim() };
        const r = f.id ? await t("referral_tiers").update(linha as never).eq("id", f.id) : await t("referral_tiers").insert(linha as never);
        if (r.error) throw r.error;
      }
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["indicacao"] }); toast.success("Configuração salva."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const muda = (i: number, p: Partial<Faixa>) => setFaixas((l) => l.map((f, k) => (k === i ? { ...f, ...p } : f)));

  return (
    <div className="space-y-6">
      <Link to="/admin/candidaturas" className="inline-flex items-center gap-1.5 text-sm text-ledger-muted hover:text-bronze"><ArrowLeft className="size-4" /> Candidaturas</Link>
      <PageHeader eyebrow="Comercial" title="Configuração de indicação" description="Cada consultora tem um link único. Quem se candidata por ele fica ligada a ela. Ao encerrar a maleta da indicada, o sistema apura a comissão sobre as peças vendidas, pela faixa da madrinha." />

      <Panel title="Faixas de comissão" action={<button type="button" className="admin-btn" onClick={() => setFaixas((l) => [...l, { min_indicadas: (l.at(-1)?.min_indicadas ?? 0) + 10, percentual: 0, titulo: "" }])}><Plus className="size-4" /> Faixa</button>}>
        {cfg.isLoading ? <Skeleton className="h-32" /> : cfg.error ? <ErrorState message={String(cfg.error)} /> : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Programa de indicação ativo</label>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-widest text-ledger-muted"><th className="py-2">A partir de (aprovadas)</th><th>Comissão %</th><th>Nome da faixa</th><th /></tr></thead>
              <tbody>{faixas.map((f, i) => (
                <tr key={f.id ?? `n${i}`} className="border-t border-line-soft">
                  <td className="py-2 pr-3"><input type="number" min={1} className="admin-input w-28" value={f.min_indicadas} onChange={(e) => muda(i, { min_indicadas: Number(e.target.value) })} /></td>
                  <td className="pr-3"><input type="number" min={0} max={50} step={0.5} className="admin-input w-24" value={f.percentual} onChange={(e) => muda(i, { percentual: Number(e.target.value) })} /></td>
                  <td className="pr-3"><input className="admin-input" value={f.titulo} onChange={(e) => muda(i, { titulo: e.target.value.slice(0, 40) })} /></td>
                  <td><button type="button" aria-label="Remover faixa" className="admin-btn" onClick={() => setFaixas((l) => l.filter((_, k) => k !== i))}><Trash2 className="size-4" /></button></td>
                </tr>))}</tbody>
            </table>
            <p className="text-xs text-ledger-muted">A comissão usa a faixa da madrinha no momento em que a maleta da indicada é encerrada. Comissões já apuradas não mudam ao alterar as faixas.</p>
            <button type="button" className="admin-btn admin-btn-primary" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar configuração"}</button>
          </div>
        )}
      </Panel>

      <Panel title="Rede de indicações">
        {painel.isLoading ? <Skeleton className="h-24" /> : painel.error ? <ErrorState message={String(painel.error)} /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-widest text-ledger-muted"><th className="py-2">Consultora</th><th>Link</th><th>Indicada por</th><th className="text-right">Candidaturas</th><th className="text-right">Aprovadas</th><th className="text-right">Comissão apurada</th></tr></thead>
            <tbody>{painel.data!.rede.map((r) => (
              <tr key={r.party_id} className="border-t border-line-soft">
                <td className="py-2 font-semibold">{r.nome}</td><td className="font-mono text-xs">?indica={r.codigo}</td><td>{r.madrinha ?? "—"}</td>
                <td className="text-right num">{r.candidaturas}</td><td className="text-right num">{r.aprovadas}</td><td className="text-right num">{brl(r.comissao_cents)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>

      <Panel title="Comissões apuradas por maleta">
        {painel.data && painel.data.comissoes.length === 0 ? <p className="text-sm text-ledger-muted">Sem dados: nenhuma maleta de consultora indicada foi encerrada ainda.</p> : (
          <ul className="space-y-2">{painel.data?.comissoes.map((c) => (
            <li key={c.id} className="rounded-xl border border-line-soft p-3">
              <details><summary className="flex cursor-pointer justify-between gap-3 text-sm"><span><strong>{c.madrinha}</strong> ← {c.indicada} · {new Date(c.em).toLocaleDateString("pt-BR")} · venda {brl(c.venda_cents)} · {c.aprovadas} aprovadas · {c.faixa} {Number(c.percentual)}%</span><strong className="num">{brl(c.comissao_cents)}</strong></summary>
                <ul className="mt-2 space-y-1 text-xs">{c.itens.map((it, k) => <li key={k} className="flex justify-between"><span>{it.qtd}× {it.produto} ({brl(it.preco_cents)})</span><span className="num">{brl(it.total_cents)}</span></li>)}</ul>
              </details>
            </li>))}</ul>
        )}
      </Panel>
    </div>
  );
}

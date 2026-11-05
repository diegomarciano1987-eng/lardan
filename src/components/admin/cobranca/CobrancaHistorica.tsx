/**
 * Cobrança histórica (dívidas vencidas até 31/12/2025): soma o saldo antigo de cada pessoa numa fatura única.
 * A fatura única é um acordo de 1 parcela sem juros nem desconto (cob_historica_consolidar) enviado ao Asaas pelo
 * disparo em lote oficial. Quem tem cobrança aberta no Asaas, acordo ativo ou está no Judicial fica de fora.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, Search } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/premium/DateField";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR } from "@/lib/cobranca";
import { dispararLoteAsaas, type ResultadoItem } from "@/lib/cobranca-asaas.functions";
import { situacaoHistorica, type DevedorHistorico } from "@/lib/cobranca-historica";

type Rpc = (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;
type Item = { party_id: string; nome: string; saldo_cents: number; parcelas: number; ok: boolean; motivo: string | null; simulacao_id: string | null };
type Consolidacao = { lote: string | null; aplicado: boolean; criadas: number; total_cents: number; itens: Item[] };
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function CobrancaHistorica() {
  const qc = useQueryClient();
  const disparar = useServerFn(dispararLoteAsaas);
  const q = useQuery({
    queryKey: ["cob", "historica"],
    queryFn: async () => {
      const { data, error } = await rpc("cob_historica_lista", {});
      if (error) throw new Error(error.message);
      return (data ?? []) as DevedorHistorico[];
    },
  });
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<"aptas" | "todas" | "bloqueadas" | "faturadas">("aptas");
  const [sel, setSel] = React.useState<string[]>([]);
  const [venc, setVenc] = React.useState<Date | undefined>(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [previa, setPrevia] = React.useState<Consolidacao | null>(null);
  const [res, setRes] = React.useState<ResultadoItem[] | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const todos = q.data ?? [];
  const lista = todos.filter((d) => {
    const s = situacaoHistorica(d);
    if (filtro === "aptas" && s.tipo !== "apta") return false;
    if (filtro === "bloqueadas" && (s.tipo === "apta" || s.tipo === "faturada")) return false;
    if (filtro === "faturadas" && s.tipo !== "faturada") return false;
    if (!busca.trim()) return true;
    const t = semAcento(busca.trim());
    return semAcento(d.nome ?? "").includes(t) || (d.codigo ?? "").toLowerCase().includes(t);
  });
  const aptas = todos.filter((d) => situacaoHistorica(d).tipo === "apta");
  const soma = (l: DevedorHistorico[]) => l.reduce((a, d) => a + Number(d.saldo_cents), 0);
  const selecionadas = todos.filter((d) => sel.includes(d.party_id));
  const vencTxt = venc ? format(venc, "yyyy-MM-dd") : "";

  const consolidar = async (aplicar: boolean) => {
    if (!sel.length) { toast.error("Selecione ao menos uma pessoa."); return; }
    if (sel.length > 200) { toast.error("No máximo 200 pessoas por lote."); return; }
    if (!vencTxt) { toast.error("Escolha o vencimento da fatura."); return; }
    setOcupado(true);
    try {
      const { data, error } = await rpc("cob_historica_consolidar", { _parties: sel, _vencimento: vencTxt, _aplicar: aplicar });
      if (error) throw new Error(error.message);
      const r = data as Consolidacao;
      setPrevia(r);
      if (aplicar) {
        toast.success(`${r.criadas} fatura(s) única(s) criada(s), total ${brl(r.total_cents)}.`);
        setSel([]);
        qc.invalidateQueries({ queryKey: ["cob"] });
      }
    } catch (e) { toast.error((e as Error).message); } finally { setOcupado(false); }
  };

  const enviarAsaas = async () => {
    const itens = (previa?.itens ?? []).filter((i) => i.simulacao_id).map((i) => ({ tipo: "acordo" as const, id: i.simulacao_id as string, nome: i.nome }));
    if (!itens.length) return;
    if (!confirm(`Enviar ${itens.length} fatura(s) única(s) ao Asaas? O Asaas avisa cada pessoa pelos canais ativos na conta.`)) return;
    setOcupado(true);
    try {
      const r = await disparar({ data: { itens, forma: "UNDEFINED" } });
      setRes(r);
      const ok = r.filter((x) => x.ok).length;
      if (ok === r.length) toast.success(`${ok} de ${r.length} enviadas ao Asaas.`);
      else toast.warning(`${ok} de ${r.length} enviadas. Veja o motivo das outras abaixo.`);
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error((e as Error).message); } finally { setOcupado(false); }
  };

  const marcarTodas = () => setSel(lista.filter((d) => situacaoHistorica(d).tipo === "apta").slice(0, 200).map((d) => d.party_id));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Archive aria-hidden className="mt-0.5 size-5 text-bronze" />
          <div>
            <h2 className="text-base font-semibold">Cobrança histórica — dívidas vencidas até 31/12/2025</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Soma todas as parcelas antigas em aberto de cada pessoa numa fatura única, sem juros e sem desconto. As dívidas originais
              são abatidas da mais antiga para a mais nova quando a fatura for paga. Nada vai ao Asaas sem a sua confirmação.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          {([
            ["Pessoas com dívida antiga", String(todos.length), brl(soma(todos))],
            ["Prontas para fatura única", String(aptas.length), brl(soma(aptas))],
            ["Bloqueadas", String(todos.filter((d) => ["asaas", "acordo", "judicial"].includes(situacaoHistorica(d).tipo)).length), "Asaas aberto, acordo ou Judicial"],
            ["Já com fatura única", String(todos.filter((d) => situacaoHistorica(d).tipo === "faturada").length), ""],
          ] as const).map(([r, v, s]) => (
            <div key={r} className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{r}</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums">{q.isLoading ? "…" : v}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{q.isLoading ? "" : s}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-72 flex-1">
            <span className="sr-only">Buscar</span>
            <Search aria-hidden className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou código"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
          </label>
          <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Filtro">
            {([["aptas", "Prontas"], ["bloqueadas", "Bloqueadas"], ["faturadas", "Com fatura"], ["todas", "Todas"]] as const).map(([v, r]) => (
              <button key={v} type="button" role="tab" aria-selected={filtro === v} onClick={() => setFiltro(v)}
                className={`rounded px-3 py-1 text-sm ${filtro === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{r}</button>
            ))}
          </div>
          <div className="w-44">
            <p className="mb-1 text-xs text-muted-foreground">Vencimento da fatura</p>
            <DateField value={venc} onChange={setVenc} shortcuts={false} />
          </div>
          <Button type="button" variant="outline" onClick={marcarTodas}>Marcar prontas (até 200)</Button>
          <Button type="button" variant="outline" disabled={ocupado || !sel.length} onClick={() => consolidar(false)}>Prévia ({sel.length})</Button>
          <Button type="button" disabled={ocupado || !sel.length} onClick={() => consolidar(true)}>Criar fatura única ({sel.length} · {brl(soma(selecionadas))})</Button>
        </div>

        {previa && (
          <div className="mt-4 rounded-xl border border-bronze/40 bg-muted/40 p-4 text-sm" data-previa>
            <p className="font-semibold">
              {previa.aplicado ? `Criadas ${previa.criadas} fatura(s) única(s)` : "Prévia — nada foi gravado"} · {previa.itens.filter((i) => i.ok).length} prontas,{" "}
              {previa.itens.filter((i) => !i.ok).length} de fora · total {brl(previa.total_cents)}
            </p>
            {previa.itens.filter((i) => !i.ok).slice(0, 20).map((i) => (
              <p key={i.party_id} className="mt-1 text-muted-foreground">{i.nome}: {i.motivo}</p>
            ))}
            {previa.aplicado && previa.criadas > 0 && (
              <Button type="button" className="mt-3 bg-asaas text-primary-foreground hover:bg-asaas/90" disabled={ocupado} onClick={enviarAsaas}>
                Enviar {previa.criadas} fatura(s) ao Asaas
              </Button>
            )}
          </div>
        )}
        {res && (
          <div className="mt-3 rounded-xl border border-border p-4 text-sm">
            {res.map((r) => (
              <p key={r.id} className={r.ok ? "text-foreground" : "text-destructive"}>
                {r.nome}: {r.ok ? `enviada${r.links[0] ? " · " : ""}` : r.erro}
                {r.ok && r.links[0] && <a className="underline" href={r.links[0]} target="_blank" rel="noreferrer">abrir fatura</a>}
              </p>
            ))}
          </div>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2">Pessoa</th><th className="px-3 py-2 text-right">Parcelas</th>
                <th className="px-3 py-2">Vencimentos</th><th className="px-3 py-2 text-right">Saldo antigo</th><th className="px-3 py-2">Situação</th></tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Carregando…</td></tr>}
              {q.error && <tr><td colSpan={6} className="px-3 py-8 text-center text-destructive">{(q.error as Error).message}</td></tr>}
              {!q.isLoading && !lista.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Sem dados.</td></tr>}
              {lista.slice(0, 300).map((d) => {
                const s = situacaoHistorica(d);
                const apta = s.tipo === "apta";
                return (
                  <tr key={d.party_id} className="border-t border-border" data-linha={d.party_id}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Selecionar ${d.nome}`} disabled={!apta} checked={sel.includes(d.party_id)}
                        onChange={(e) => setSel((v) => e.target.checked ? [...v, d.party_id] : v.filter((x) => x !== d.party_id))} className="size-4 accent-primary" />
                    </td>
                    <td className="px-3 py-2"><span className="font-medium">{d.nome}</span>{d.codigo && <span className="ml-2 text-xs text-muted-foreground">Cód. {d.codigo}</span>}
                      {d.tem_recente && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem]">também deve em 2026</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.parcelas}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataBR(d.venc_min)}{d.venc_max !== d.venc_min ? ` a ${dataBR(d.venc_max)}` : ""}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(Number(d.saldo_cents))}</td>
                    <td className={`px-3 py-2 text-xs ${apta ? "text-foreground" : "text-muted-foreground"}`}>{s.rotulo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lista.length > 300 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Mostrando 300 de {lista.length}. Use a busca para achar as outras.</p>}
        </div>
      </section>
    </div>
  );
}

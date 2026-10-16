import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR, rotuloEtapa, ROTULO_SIMULACAO } from "@/lib/cobranca";
import { dispararLoteAsaas, type ResultadoItem } from "@/lib/cobranca-asaas.functions";

export const Route = createFileRoute("/_authenticated/admin/cobranca_/lote")({
  head: () => ({ meta: [{ title: "Cobrança em lote Asaas — Lardan" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Lote,
});

interface Acordo { id: string; party_id: string; nome: string; total_cents: number; entrada_cents: number; parcelas: number; status: string; ja_enviadas: number }
interface ParcelaL { id: string; party_id: string; nome: string; saldo_cents: number; vencimento: string; etapa: string; em_acordo: boolean }
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function candidatos(): Promise<{ acordos: Acordo[]; parcelas: ParcelaL[] }> {
  const { data, error } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown; error: { message: string } | null }>)("cob_lote_candidatos");
  if (error) throw new Error(error.message);
  return data as { acordos: Acordo[]; parcelas: ParcelaL[] };
}

function Lote() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cob", "lote"], queryFn: candidatos });
  const disparar = useServerFn(dispararLoteAsaas);
  const [aba, setAba] = React.useState<"acordos" | "dividas">("acordos");
  const [forma, setForma] = React.useState<"UNDEFINED" | "PIX" | "BOLETO" | "CREDIT_CARD">("UNDEFINED");
  const [selA, setSelA] = React.useState<string[]>([]);
  const [selP, setSelP] = React.useState<string[]>([]);
  const [busca, setBusca] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [res, setRes] = React.useState<ResultadoItem[] | null>(null);

  const acordos = (q.data?.acordos ?? []).filter((a) => a.ja_enviadas === 0 && (!busca || semAcento(a.nome).includes(semAcento(busca))));
  const parcelas = (q.data?.parcelas ?? []).filter((p) => !p.em_acordo && (!busca || semAcento(p.nome).includes(semAcento(busca))));
  const totalSel = aba === "acordos" ? acordos.filter((a) => selA.includes(a.id)).reduce((s, a) => s + Number(a.total_cents) - Number(a.entrada_cents), 0)
    : parcelas.filter((p) => selP.includes(p.id)).reduce((s, p) => s + Number(p.saldo_cents), 0);
  const nSel = aba === "acordos" ? selA.length : selP.length;

  const enviar = async () => {
    const itens = aba === "acordos" ? acordos.filter((a) => selA.includes(a.id)).map((a) => ({ tipo: "acordo" as const, id: a.id, nome: a.nome }))
      : parcelas.filter((p) => selP.includes(p.id)).map((p) => ({ tipo: "parcela" as const, id: p.id, nome: p.nome }));
    if (!itens.length) { toast.error("Selecione ao menos um item."); return; }
    if (!confirm(`Enviar ${itens.length} cobrança(s) ao Asaas, total ${brl(totalSel)}? O Asaas avisa cada pessoa pelos canais ativos na conta (e-mail, SMS, WhatsApp).`)) return;
    setEnviando(true); setRes(null);
    try {
      const r = await disparar({ data: { itens, forma } });
      setRes(r); setSelA([]); setSelP([]);
      const ok = r.filter((x) => x.ok).length;
      toast.success(`${ok} de ${r.length} enviados ao Asaas.`);
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } finally { setEnviando(false); }
  };
  const toggle = (lista: string[], set: (v: string[]) => void, id: string) => set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  const th = "px-3 py-2 text-left text-xs text-muted-foreground";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <Link to="/admin/cobranca" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Voltar à cobrança</Link>
      <header className="rounded-2xl border border-asaas/40 bg-card p-6">
        <p className="ledger-eyebrow">Asaas</p>
        <h1 className="font-display text-3xl">Cobrança em lote</h1>
        <p className="mt-1 text-sm text-muted-foreground">Marque os acordos ou as dívidas e envie tudo de uma vez. Cada cobrança nasce ligada à dívida: quando a pessoa paga, a baixa e a conciliação são automáticas. Quem já tem cobrança aberta no Asaas não aparece aqui, para ninguém receber duas.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border p-1">
          {([["acordos", `Acordos (${acordos.length})`], ["dividas", `Dívidas sem cobrança (${parcelas.length})`]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setAba(k)} className={`rounded-md px-4 py-1.5 text-sm ${aba === k ? "bg-asaas text-asaas-foreground" : "text-muted-foreground"}`}>{r}</button>
          ))}
        </div>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" className="h-10 w-64 rounded-lg border border-border bg-background px-3 text-sm" />
        <div className="flex rounded-lg border border-border p-1">
          {([["UNDEFINED", "Cliente escolhe (Pix, boleto ou cartão)"], ["PIX", "Pix"], ["BOLETO", "Boleto"], ["CREDIT_CARD", "Cartão até 12x"]] as const).map(([k, r]) => (
            <button key={k} onClick={() => setForma(k)} className={`rounded-md px-3 py-1.5 text-xs ${forma === k ? "bg-asaas text-asaas-foreground" : "text-muted-foreground"}`}>{r}</button>
          ))}
        </div>
      </div>

      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p> : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-card">
          {aba === "acordos" ? (acordos.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Sem dados: nenhum acordo com parcelas aguardando envio.</p> : (
            <table className="w-full text-sm"><thead className="sticky top-0 bg-card"><tr>
              <th className={th}><input type="checkbox" aria-label="Marcar todos" checked={selA.length === acordos.length} onChange={(e) => setSelA(e.target.checked ? acordos.map((a) => a.id) : [])} /></th>
              <th className={th}>Pessoa</th><th className={th}>Situação</th><th className={th}>Parcelas</th><th className={`${th} text-right`}>A cobrar</th></tr></thead>
              <tbody>{acordos.map((a) => (
                <tr key={a.id} className="border-t border-border"><td className="px-3 py-2"><input type="checkbox" aria-label={`Marcar ${a.nome}`} checked={selA.includes(a.id)} onChange={() => toggle(selA, setSelA, a.id)} /></td>
                  <td className="px-3 py-2"><Link to="/admin/cobranca/$id" params={{ id: a.party_id }} className="hover:underline">{a.nome}</Link></td>
                  <td className="px-3 py-2">{ROTULO_SIMULACAO[a.status] ?? a.status}</td><td className="px-3 py-2">{a.parcelas}x</td>
                  <td className="px-3 py-2 text-right font-mono">{brl(Number(a.total_cents) - Number(a.entrada_cents))}</td></tr>))}</tbody></table>
          )) : (parcelas.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Sem dados: nenhuma dívida aberta sem cobrança.</p> : (
            <table className="w-full text-sm"><thead className="sticky top-0 bg-card"><tr>
              <th className={th}><input type="checkbox" aria-label="Marcar todas" checked={selP.length === parcelas.length} onChange={(e) => setSelP(e.target.checked ? parcelas.map((p) => p.id) : [])} /></th>
              <th className={th}>Pessoa</th><th className={th}>Etapa</th><th className={th}>Vencimento</th><th className={`${th} text-right`}>Saldo</th></tr></thead>
              <tbody>{parcelas.map((p) => (
                <tr key={p.id} className="border-t border-border"><td className="px-3 py-2"><input type="checkbox" aria-label={`Marcar ${p.nome} ${dataBR(p.vencimento)}`} checked={selP.includes(p.id)} onChange={() => toggle(selP, setSelP, p.id)} /></td>
                  <td className="px-3 py-2"><Link to="/admin/cobranca/$id" params={{ id: p.party_id }} className="hover:underline">{p.nome}</Link></td>
                  <td className="px-3 py-2">{rotuloEtapa(p.etapa)}</td><td className="px-3 py-2">{dataBR(p.vencimento)}</td>
                  <td className="px-3 py-2 text-right font-mono">{brl(Number(p.saldo_cents))}</td></tr>))}</tbody></table>
          ))}
        </div>
      )}

      <div className="sticky bottom-24 flex items-center justify-between rounded-xl border border-asaas/40 bg-card p-4">
        <span className="text-sm">{nSel} selecionado(s) · <b className="font-mono">{brl(totalSel)}</b></span>
        <button disabled={enviando || nSel === 0} onClick={enviar} className="h-10 rounded-lg bg-asaas px-6 text-sm font-semibold text-asaas-foreground disabled:opacity-50">{enviando ? "Enviando ao Asaas…" : "Enviar ao Asaas"}</button>
      </div>

      {res && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-5" data-testid="resultado-lote">
          <h2 className="font-semibold">Resultado do envio</h2>
          {res.map((r) => (
            <p key={r.tipo + r.id} className={`text-sm ${r.ok ? "" : "text-destructive"}`}>{r.ok ? "Enviado" : "Não enviado"} · {r.nome ?? r.id} · {r.cobrancas} cobrança(s){r.links[0] && <> · <a href={r.links[0]} target="_blank" rel="noopener noreferrer" className="underline">abrir fatura</a></>}{r.erro && ` — ${r.erro}`}</p>
          ))}
        </section>
      )}
    </div>
  );
}

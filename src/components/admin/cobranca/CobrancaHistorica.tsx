/**
 * Cobrança histórica (dívidas vencidas até 31/12/2025): soma o saldo antigo de cada pessoa numa fatura única.
 * A fatura única é um acordo de 1 parcela sem juros nem desconto (cob_historica_consolidar) enviado ao Asaas pelo
 * disparo em lote oficial. Quem tem cobrança aberta no Asaas, acordo ativo ou está no Judicial fica de fora.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, Search, Handshake, Mail, MessageCircle, FileSignature } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { GavetaAcordoHistorica } from "./GavetaAcordoHistorica";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/premium/DateField";
import { supabase } from "@/integrations/supabase/client";
import { brl, dataBR } from "@/lib/cobranca";
import { dispararLoteAsaas, type ResultadoItem } from "@/lib/cobranca-asaas.functions";
import { situacaoHistorica, rotuloTermo, type DevedorHistorico } from "@/lib/cobranca-historica";
import { termosConfissao } from "@/lib/termo-confissao";
import { zapsignConfissao } from "@/lib/zapsign/zapsign.functions";
import { useCobrancaSomenteLeitura } from "@/lib/cobranca-leitura";

type Rpc = (f: string, a: object) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc: Rpc = (f, a) => (supabase.rpc as unknown as Rpc).call(supabase, f, a);
type Item = { party_id: string; nome: string; saldo_cents: number; parcelas: number; ok: boolean; motivo: string | null; simulacao_id: string | null };
type Contato = { party_id: string; email: string | null; celular: string | null; telefone_invalido: string | null; cpf_ok: boolean; asaas_vinculado: boolean };
type Consolidacao = { lote: string | null; aplicado: boolean; criadas: number; total_cents: number; itens: Item[] };

export function CobrancaHistorica() {
  const leitura = useCobrancaSomenteLeitura();
  const qc = useQueryClient();
  const disparar = useServerFn(dispararLoteAsaas);
  const mandarTermo = useServerFn(zapsignConfissao);
  const q = useQuery({
    queryKey: ["cob", "historica"],
    queryFn: async () => {
      const { data, error } = await rpc("cob_historica_lista", {});
      if (error) throw new Error(error.message);
      return (data ?? []) as DevedorHistorico[];
    },
  });
  // 18/11: contato de cada pessoa (e-mail / celular que recebe SMS e WhatsApp) — se faltar, a tela avisa antes do acordo.
  const ids = (q.data ?? []).map((d) => d.party_id);
  const contatos = useQuery({
    queryKey: ["cob", "historica-contatos", ids.length],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await rpc("cob_contatos_avisos", { _parties: ids.slice(0, 2000) });
      if (error) throw new Error(error.message);
      return new Map(((data ?? []) as Contato[]).map((c) => [c.party_id, c]));
    },
  });
  // 18/11 (Diego): todo acordo da base histórica leva termo de confissão — a lista mostra quem já assinou.
  const acordoIds = (q.data ?? []).map((d) => d.acordo_id).filter((x): x is string => !!x);
  const termos = useQuery({
    queryKey: ["cob", "historica-termos", acordoIds.join(",").length, acordoIds.length],
    enabled: acordoIds.length > 0,
    queryFn: () => termosConfissao(acordoIds),
  });
  const [termoRes, setTermoRes] = React.useState<Record<string, string>>({});
  const [acordoDe, setAcordoDe] = React.useState<DevedorHistorico | null>(null);
  const [busca, setBusca] = React.useState("");
  const [buscaLenta, setBuscaLenta] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setBuscaLenta(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  // Busca no servidor: nome em partes, código atual/antigo e CPF (consultora_termo_casa).
  const qb = useQuery({
    queryKey: ["cob", "historica-busca", buscaLenta],
    enabled: buscaLenta.length > 0,
    queryFn: async () => {
      const { data, error } = await rpc("cob_historica_buscar", { _termo: buscaLenta });
      if (error) throw new Error(error.message);
      return new Set((data ?? []) as string[]);
    },
  });
  const [filtro, setFiltro] = React.useState<"aptas" | "todas" | "bloqueadas" | "faturadas" | "sem_termo">("aptas");
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
    if (filtro === "sem_termo" && (!d.acordo_id || s.tipo === "judicial" || rotuloTermo(termos.data?.get(d.acordo_id)).tipo === "assinado")) return false;
    if (!buscaLenta) return true;
    return qb.data ? qb.data.has(d.party_id) : true;
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
      if (ok === r.length) toast.success(`${ok} de ${r.length} enviadas ao Asaas. Enviando os termos de confissão…`);
      else toast.warning(`${ok} de ${r.length} enviadas. Veja o motivo das outras abaixo.`);
      // Termo de confissão de cada fatura enviada, um por vez; o que faltar no cadastro aparece na linha.
      const out: Record<string, string> = {};
      let termosOk = 0;
      for (const x of r.filter((y) => y.ok)) {
        try {
          const t = await mandarTermo({ data: { simulacaoId: x.id, reenviar: false } });
          termosOk++;
          out[x.id] = t.jaExistia ? "termo já aguardava assinatura" : t.whatsapp ? "termo enviado no WhatsApp" : "termo criado sem WhatsApp — copie o link no acordo";
        } catch (e) { out[x.id] = `termo NÃO enviado: ${e instanceof Error ? e.message : "erro na ZapSign"}`; }
        setTermoRes({ ...out });
      }
      if (ok) (termosOk === ok ? toast.success : toast.warning)(`Termos de confissão: ${termosOk} de ${ok} enviados.`);
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
              Soma todas as parcelas antigas em aberto de cada pessoa numa fatura única, sem juros e sem desconto — ou use “Gerar acordo” na linha da pessoa para parcelar (entrada, 2x a 48x, desconto). As dívidas originais
              são abatidas da mais antiga para a mais nova quando a fatura for paga. Nada vai ao Asaas sem a sua confirmação; ao gerar as cobranças, o termo de confissão de dívida segue junto para ela assinar (ZapSign).
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
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, código ou CPF"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm" />
          </label>
          <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Filtro">
            {([["aptas", "Prontas"], ["bloqueadas", "Bloqueadas"], ["faturadas", "Com fatura"], ["sem_termo", "Termo não assinado"], ["todas", "Todas"]] as const).map(([v, r]) => (
              <button key={v} type="button" role="tab" aria-selected={filtro === v} onClick={() => setFiltro(v)}
                className={`rounded px-3 py-1 text-sm ${filtro === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{r}</button>
            ))}
          </div>
          {!leitura && <><div className="w-44">
            <p className="mb-1 text-xs text-muted-foreground">Vencimento da fatura</p>
            <DateField value={venc} onChange={setVenc} shortcuts={false} />
          </div>
          <Button type="button" variant="outline" onClick={marcarTodas}>Marcar prontas (até 200)</Button>
          <Button type="button" variant="outline" disabled={ocupado || !sel.length} onClick={() => consolidar(false)}>Prévia ({sel.length})</Button>
          <Button type="button" disabled={ocupado || !sel.length} onClick={() => consolidar(true)}>Criar fatura única ({sel.length} · {brl(soma(selecionadas))})</Button></>}
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
                {(() => { const t = termoRes[r.id]; return t ? <span className={t.startsWith("termo NÃO") ? "text-destructive" : "text-muted-foreground"}> · {t}</span> : null; })()}
              </p>
            ))}
          </div>
        )}

        {contatos.data && todos.length > 0 && (() => {
          const semEmail = todos.filter((d) => !contatos.data.get(d.party_id)?.email).length;
          const semCel = todos.filter((d) => !contatos.data.get(d.party_id)?.celular).length;
          return (semEmail || semCel) ? (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm" data-aviso-contatos>
              <b>Atenção aos avisos do Asaas:</b> {semEmail} de {todos.length} sem e-mail no cadastro (não recebem a fatura por e-mail) e {semCel} sem celular válido
              (não recebem SMS nem WhatsApp). Ao gerar o acordo, a tela mostra o que falta e deixa corrigir.
            </p>
          ) : null;
        })()}

        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2">Pessoa</th><th className="px-3 py-2 text-right">Parcelas</th>
                <th className="px-3 py-2">Vencimentos</th><th className="px-3 py-2 text-right">Saldo antigo</th><th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2">Avisos Asaas</th><th className="px-3 py-2">Termo</th><th className="px-3 py-2 text-right">Acordo</th></tr>
            </thead>
            <tbody>
              {q.isLoading && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Carregando…</td></tr>}
              {q.error && <tr><td colSpan={9} className="px-3 py-8 text-center text-destructive">{(q.error as Error).message}</td></tr>}
              {buscaLenta && qb.isFetching && <tr><td colSpan={9} className="px-3 py-3 text-center text-xs text-muted-foreground">Buscando…</td></tr>}
              {!q.isLoading && !qb.isFetching && !lista.length && <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">{buscaLenta ? `Nada encontrado para “${buscaLenta}”.` : "Sem dados."}</td></tr>}
              {lista.slice(0, 300).map((d) => {
                const s = situacaoHistorica(d);
                const apta = s.tipo === "apta";
                return (
                  <tr key={d.party_id} className="border-t border-border" data-linha={d.party_id}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Selecionar ${d.nome}`} disabled={!apta} checked={sel.includes(d.party_id)}
                        onChange={(e) => setSel((v) => e.target.checked ? [...v, d.party_id] : v.filter((x) => x !== d.party_id))} className="size-4 accent-primary" />
                    </td>
                    <td className="px-3 py-2"><Link to="/admin/cobranca/$id" params={{ id: d.party_id }} className="font-medium hover:underline">{d.nome}</Link>{d.codigo && <span className="ml-2 text-xs text-muted-foreground">Cód. {d.codigo}</span>}
                      {d.tem_recente && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem]">também deve em 2026</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.parcelas}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{dataBR(d.venc_min)}{d.venc_max !== d.venc_min ? ` a ${dataBR(d.venc_max)}` : ""}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{brl(Number(d.saldo_cents))}</td>
                    <td className={`px-3 py-2 text-xs ${apta ? "text-foreground" : "text-muted-foreground"}`}>{s.rotulo}</td>
                    <td className="px-3 py-2 text-xs">{(() => {
                      const c = contatos.data?.get(d.party_id);
                      if (!c) return <span className="text-muted-foreground">…</span>;
                      return (
                        <span className="flex flex-wrap gap-1">
                          <span title={c.email ?? "Sem e-mail no cadastro"} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${c.email ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                            <Mail aria-hidden className="size-3" />{c.email ? "e-mail" : "sem e-mail"}</span>
                          <span title={c.celular ?? (c.telefone_invalido ? `Número inválido: ${c.telefone_invalido}` : "Sem celular")} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${c.celular ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                            <MessageCircle aria-hidden className="size-3" />{c.celular ? "WhatsApp/SMS" : c.telefone_invalido ? "celular inválido" : "sem celular"}</span>
                        </span>
                      );
                    })()}</td>
                    <td className="px-3 py-2 text-xs">{(() => {
                      if (!d.acordo_id || s.tipo === "judicial") return <span className="text-muted-foreground">—</span>;
                      if (termos.isLoading) return <span className="text-muted-foreground">…</span>;
                      const t = rotuloTermo(termos.data?.get(d.acordo_id));
                      const cor = t.tipo === "assinado" ? "bg-success/10 text-success" : t.tipo === "pendente" ? "bg-warning/10 text-warning" : "bg-danger/10 text-danger";
                      return <span data-termo-linha={t.tipo} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${cor}`}><FileSignature aria-hidden className="size-3" />{t.tipo === "assinado" ? "assinado" : t.tipo === "pendente" ? "aguardando" : "sem termo"}</span>;
                    })()}</td>
                    <td className="px-3 py-2 text-right">
                      {s.tipo === "judicial" ? <span className="text-xs text-muted-foreground">Jurídico</span> : leitura ? <span className="text-xs text-muted-foreground">—</span> : (
                        <Button type="button" size="sm" variant={s.tipo === "apta" ? "default" : "outline"} onClick={() => setAcordoDe(d)} aria-label={`Gerar acordo de ${d.nome}`}>
                          <Handshake aria-hidden className="size-3.5" />{s.tipo === "acordo" || s.tipo === "faturada" ? "Ver acordo" : "Gerar acordo"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {lista.length > 300 && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Mostrando 300 de {lista.length}. Use a busca para achar as outras.</p>}
        </div>
      </section>
      <GavetaAcordoHistorica alvo={acordoDe} onClose={() => setAcordoDe(null)} />
    </div>
  );
}

import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Truck } from "lucide-react";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { EmptyState, ErrorState, Panel, Skeleton, StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { DateField } from "@/components/premium/DateField";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { reaisParaCentavos } from "@/lib/financeiro";
import {
  MESES, calcularAcerto, excluirAcerto, operacaoDoAcerto, painelAcertos, salvarAcerto,
  type AcertoBase, type AcertoLinha, type Painel,
} from "@/lib/acertos-representantes";

export const Route = createFileRoute("/_authenticated/admin/financeiro/acertos-representantes")({
  component: () => (
    <AreaFinanceiraGuard capacidade="finance.view">
      <AcertosRepresentantes />
    </AreaFinanceiraGuard>
  ),
  head: () => ({
    meta: [
      { title: "Acertos dos representantes — Financeiro Lardan" },
      { name: "description", content: "Comissão, recebimento, gastos e retenção dos representantes por praça." },
      { property: "og:title", content: "Acertos dos representantes — Financeiro Lardan" },
      { property: "og:description", content: "Comissão, recebimento, gastos e retenção dos representantes por praça." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const brl = (c: number | null | undefined) => (c == null ? "—" : formatBRLFromCents(Number(c)));
const pct = (v: number | null | undefined, casas = 1) => (v == null ? "—" : `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`);
const nomeCurto = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1]}` : n; };
const dataBR = (d: string) => d.split("-").reverse().join("/");
const TOM_FAIXA: Record<string, "success" | "info" | "warning" | "danger" | "neutral"> = {
  EXCELENTE: "success", TOP: "success", BOM: "info", "MÉDIA": "warning", "CRÍTICO 2": "danger", "CRÍTICO": "danger",
};
const isoHoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const paraIso = (d?: Date) => (d ? d.toLocaleDateString("sv-SE") : "");
const deIso = (s: string) => (s ? new Date(`${s}T12:00:00`) : undefined);

function AcertosRepresentantes() {
  const [rep, setRep] = React.useState("");
  const [ano, setAno] = React.useState(String(new Date().getFullYear()));
  const [aberto, setAberto] = React.useState<AcertoLinha | "novo" | null>(null);
  const q = useQuery({ queryKey: ["rep-acertos", rep, ano], queryFn: () => painelAcertos(rep || null, Number(ano) || null) });

  const d = q.data;
  const linhas = d?.linhas ?? [];
  const tot = React.useMemo(() => {
    const s = (k: keyof AcertoLinha) => linhas.reduce((t, l) => t + Number((l[k] as number | null) ?? 0), 0);
    const liq = s("venda_liquida_cents");
    return {
      bruta: s("venda_bruta_cents"), liquida: liq, receb: s("recebimento_cents"), comissao: s("comissao_cents"),
      retido: s("retido_calc_cents"), livre: s("livre_cents"), gastos: s("gastos_cents"), dif: s("diferenca_cents"),
      pctRec: liq > 0 ? s("recebimento_cents") / liq : null, atend: s("clientes_atendidas"), aberturas: s("aberturas"), cortes: s("cortes"),
    };
  }, [linhas]);
  const porMes = React.useMemo(() => {
    const m = new Map<string, AcertoLinha[]>();
    for (const l of linhas) { const k = l.data.slice(0, 7); m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()];
  }, [linhas]);

  const opcoesRep = [{ value: "", label: "Todos os representantes" }, ...(d?.representantes ?? []).map((r) => ({ value: r.id, label: r.nome }))];
  const anoAtual = new Date().getFullYear();
  const opcoesAno = [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map((a) => ({ value: String(a), label: String(a) }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="max-w-2xl text-sm text-ledger-muted">
            Cada semana de praça: recebimento, faixa de comissão pela tabela vigente na data, gastos, retenção e a comissão livre a pagar.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72"><SmartSelect options={opcoesRep} value={rep} onChange={setRep} placeholder="Representante" /></div>
          <div className="w-32"><SmartSelect options={opcoesAno} value={ano} onChange={setAno} placeholder="Ano" /></div>
          {d?.pode_editar && (
            <button type="button" className="admin-btn admin-btn-primary h-11" onClick={() => setAberto("novo")}>
              <Plus aria-hidden className="size-4" /> Novo acerto
            </button>
          )}
        </div>
      </div>

      {q.isPending ? <Skeleton className="h-64" /> : q.isError ? (
        <ErrorState message="Não foi possível carregar os acertos." onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="kpis-acertos">
            <Kpi t="Venda bruta" v={brl(tot.bruta)} s={`Líquida ${brl(tot.liquida)}`} />
            <Kpi t="Recebimento das praças" v={brl(tot.receb)} s={`${pct(tot.pctRec)} da venda líquida`} />
            <Kpi t="Comissão calculada" v={brl(tot.comissao)} s={`${linhas.length} acertos`} />
            <Kpi t="Diferença de pagamento" v={brl(tot.dif)} s="Recebido − repassado" alerta={tot.dif > 0} />
            <Kpi t="Retido (reserva)" v={brl(tot.retido)} s={d?.config?.retencao_desde ? `${pct(d.config.retencao_pct, 0)} desde ${dataBR(d.config.retencao_desde)}` : "Sem retenção"} />
            <Kpi t="Comissão livre" v={brl(tot.livre)} s={`Gastos lançados ${brl(tot.gastos)}`} destaque />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi t="Clientes atendidas" v={tot.atend.toLocaleString("pt-BR")} s="Soma das visitas" />
            <Kpi t="Aberturas" v={tot.aberturas.toLocaleString("pt-BR")} s="Novas consultoras" />
            <Kpi t="Cortes" v={tot.cortes.toLocaleString("pt-BR")} s={tot.atend > 0 ? `Taxa de corte ${pct(tot.cortes / tot.atend)}` : "—"} />
          </div>

          {linhas.length === 0 ? (
            <Panel><EmptyState title="Sem acertos" description="Nenhum acerto lançado para esse filtro." /></Panel>
          ) : porMes.map(([mes, ls]) => {
            const [a, m] = mes.split("-");
            const soma = (k: keyof AcertoLinha) => ls.reduce((t, l) => t + Number((l[k] as number | null) ?? 0), 0);
            return (
              <Panel key={mes} title={`${MESES[Number(m) - 1] ?? m} de ${a}`} flush>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-bronze">
                        <th className="px-5 py-2.5">Data</th><th className="px-3 py-2.5">Praça</th>
                        {!rep && <th className="px-3 py-2.5">Representante</th>}
                        <th className="px-3 py-2.5 text-right">Atend. / Abert. / Cortes</th>
                        <th className="px-3 py-2.5 text-right">Venda líquida</th><th className="px-3 py-2.5 text-right">Recebimento</th>
                        <th className="px-3 py-2.5">Faixa</th><th className="px-3 py-2.5 text-right">Comissão</th>
                        <th className="px-3 py-2.5 text-right">Diferença</th><th className="px-3 py-2.5 text-right">Gastos</th>
                        <th className="px-3 py-2.5 text-right">Retido</th><th className="px-5 py-2.5 text-right">Livre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ls.map((l) => (
                        <tr key={l.id} className="cursor-pointer border-b border-line-soft transition-colors hover:bg-surface-muted" onClick={() => setAberto(l)} data-acerto-linha="">
                          <td className="num whitespace-nowrap px-5 py-2.5 font-semibold">{dataBR(l.data)}</td>
                          <td className="px-3 py-2.5">{l.praca}{l.responsavel_nome && <span className="block text-xs text-ledger-muted">{l.responsavel_nome}</span>}</td>
                          {!rep && <td className="whitespace-nowrap px-3 py-2.5 text-ledger-muted" title={l.rep_nome}>{nomeCurto(l.rep_nome)}</td>}
                          <td className="num px-3 py-2.5 text-right">{l.clientes_atendidas ?? "—"} / {l.aberturas ?? "—"} / {l.cortes ?? "—"}</td>
                          <td className="num px-3 py-2.5 text-right">{brl(l.venda_liquida_cents)}</td>
                          <td className="num px-3 py-2.5 text-right">{brl(l.recebimento_cents)}<span className="block text-xs text-ledger-muted">{pct(l.pct_recebimento)}</span></td>
                          <td className="px-3 py-2.5">{l.faixa ? <StatusBadge tone={TOM_FAIXA[l.faixa] ?? "neutral"}>{l.faixa} · {pct(l.pct_comissao)}</StatusBadge> : "—"}</td>
                          <td className="num px-3 py-2.5 text-right font-semibold">{brl(l.comissao_cents)}</td>
                          <td className={`num px-3 py-2.5 text-right ${l.diferenca_cents > 0 ? "text-destructive" : ""}`}>{brl(l.diferenca_cents)}</td>
                          <td className="num px-3 py-2.5 text-right">{brl(l.gastos_cents)}</td>
                          <td className="num px-3 py-2.5 text-right">{brl(l.retido_calc_cents)}</td>
                          <td className="num px-5 py-2.5 text-right font-bold text-ledger-text">{brl(l.livre_cents)}</td>
                        </tr>
                      ))}
                      <tr className="bg-surface-muted/60 font-semibold">
                        <td className="px-5 py-2.5" colSpan={rep ? 3 : 4}>Total do mês</td>
                        <td className="num px-3 py-2.5 text-right">{brl(soma("venda_liquida_cents"))}</td>
                        <td className="num px-3 py-2.5 text-right">{brl(soma("recebimento_cents"))}</td>
                        <td />
                        <td className="num px-3 py-2.5 text-right">{brl(soma("comissao_cents"))}</td>
                        <td className="num px-3 py-2.5 text-right">{brl(soma("diferenca_cents"))}</td>
                        <td className="num px-3 py-2.5 text-right">{brl(soma("gastos_cents"))}</td>
                        <td className="num px-3 py-2.5 text-right">{brl(soma("retido_calc_cents"))}</td>
                        <td className="num px-5 py-2.5 text-right">{brl(soma("livre_cents"))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
        </>
      )}

      {d && <FichaAcerto painel={d} alvo={aberto} repPadrao={rep} onClose={() => setAberto(null)} />}
    </div>
  );
}

function Kpi({ t, v, s, alerta, destaque }: { t: string; v: string; s?: string; alerta?: boolean; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${destaque ? "border-primary/40 bg-primary/5" : "border-line-soft bg-surface"}`}>
      <p className="text-[0.75rem] font-semibold text-ledger-muted">{t}</p>
      <strong className={`num mt-1 block font-display text-xl font-semibold ${alerta ? "text-destructive" : "text-ledger-text"}`}>{v}</strong>
      {s && <p className="mt-0.5 text-xs text-ledger-muted">{s}</p>}
    </div>
  );
}

const CAMPOS_DINHEIRO = [
  ["estoque_enviado_cents", "Estoque enviado"], ["venda_bruta_cents", "Venda bruta"], ["venda_liquida_cents", "Venda líquida"],
  ["recebimento_cents", "Recebimento da praça"], ["total_pago_cents", "Total repassado"],
] as const;
const CAMPOS_GASTOS = [["combustivel_cents", "Combustível"], ["hotel_cents", "Hotel"], ["alimentacao_cents", "Alimentação"], ["outros_cents", "Outros"]] as const;
const CAMPOS_NUM = [["clientes_atendidas", "Clientes atendidas"], ["aberturas", "Aberturas"], ["cortes", "Cortes"], ["nao_atendidas", "Não atendidas"]] as const;

const centsTexto = (c: number | null | undefined) => (c == null ? "" : (Number(c) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function FichaAcerto({ painel, alvo, repPadrao, onClose }: { painel: Painel; alvo: AcertoLinha | "novo" | null; repPadrao: string; onClose: () => void }) {
  const qc = useQueryClient();
  const vazio = (): Record<string, string> => ({ representante_party_id: repPadrao, data: isoHoje(), praca: "", responsavel_nome: "", observacao: "", retido_cents: "", desconto_pessoal_cents: "" });
  const [f, setF] = React.useState<Record<string, string>>(vazio);
  const [motivo, setMotivo] = React.useState("");
  const editar = painel.pode_editar;
  React.useEffect(() => {
    if (!alvo) return;
    if (alvo === "novo") { setF(vazio()); return; }
    const o: Record<string, string> = {
      id: alvo.id, representante_party_id: alvo.representante_party_id, data: alvo.data, praca: alvo.praca,
      responsavel_nome: alvo.responsavel_nome ?? "", observacao: alvo.observacao ?? "",
    };
    for (const [k] of [...CAMPOS_DINHEIRO, ...CAMPOS_GASTOS]) o[k] = centsTexto(alvo[k]);
    o["retido_cents"] = centsTexto(alvo.retido_cents);
    o["desconto_pessoal_cents"] = centsTexto(alvo.desconto_pessoal_cents);
    for (const [k] of CAMPOS_NUM) o[k] = alvo[k] == null ? "" : String(alvo[k]);
    setF(o);
    setMotivo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

  const dados: AcertoBase = React.useMemo(() => {
    const c = (k: string) => reaisParaCentavos(f[k] ?? "");
    const n = (k: string) => ((f[k] ?? "").trim() === "" ? null : Number((f[k] ?? "").replace(/\D/g, "")));
    return {
      ...(f["id"] ? { id: f["id"] } : {}),
      representante_party_id: f["representante_party_id"] ?? "", data: f["data"] ?? "", praca: f["praca"] ?? "",
      responsavel_nome: f["responsavel_nome"] || null, observacao: f["observacao"] || null,
      clientes_atendidas: n("clientes_atendidas"), aberturas: n("aberturas"), cortes: n("cortes"), nao_atendidas: n("nao_atendidas"),
      estoque_enviado_cents: c("estoque_enviado_cents"), venda_bruta_cents: c("venda_bruta_cents"), venda_liquida_cents: c("venda_liquida_cents"),
      recebimento_cents: c("recebimento_cents"), total_pago_cents: c("total_pago_cents"),
      combustivel_cents: c("combustivel_cents") ?? 0, hotel_cents: c("hotel_cents") ?? 0, alimentacao_cents: c("alimentacao_cents") ?? 0, outros_cents: c("outros_cents") ?? 0,
      retido_cents: c("retido_cents"), desconto_pessoal_cents: c("desconto_pessoal_cents") ?? 0,
    };
  }, [f]);
  const calc = calcularAcerto(dados, painel.tabelas, painel.config);

  const op = useQuery({
    queryKey: ["rep-acerto-operacao", dados.representante_party_id, dados.data],
    enabled: !!alvo && !!dados.representante_party_id && /^\d{4}-\d{2}-\d{2}$/.test(dados.data),
    queryFn: () => operacaoDoAcerto(dados.representante_party_id, dados.data),
  });
  const salvar = useMutation({
    mutationFn: () => salvarAcerto(dados),
    onSuccess: () => { toast.success("Acerto salvo."); void qc.invalidateQueries({ queryKey: ["rep-acertos"] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const excluir = useMutation({
    mutationFn: () => excluirAcerto(f["id"] ?? "", motivo),
    onSuccess: () => { toast.success("Acerto excluído. Fica registrado na auditoria."); void qc.invalidateQueries({ queryKey: ["rep-acertos"] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((o) => ({ ...o, [k]: e.target.value }));
  const campo = (k: string, rotulo: string, modo: "decimal" | "numeric" | "text" = "decimal") => (
    <label key={k} className="grid gap-1 text-xs font-semibold text-ledger-muted">
      {rotulo}
      <input className="admin-input h-10 text-sm font-normal text-ledger-text" inputMode={modo} disabled={!editar} value={f[k] ?? ""} onChange={set(k)} aria-label={rotulo}
        placeholder={modo === "decimal" ? "0,00" : ""} />
    </label>
  );
  const opRep = painel.representantes.map((r) => ({ value: r.id, label: r.nome }));

  return (
    <Sheet open={!!alvo} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader><SheetTitle>{alvo === "novo" ? "Novo acerto de representante" : `Acerto · ${f["praca"]} · ${dataBR(f["data"] ?? "")}`}</SheetTitle></SheetHeader>
        <div className="mt-5 space-y-6 px-1 pb-8">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 text-xs font-semibold text-ledger-muted">Representante
              <SmartSelect options={opRep} value={f["representante_party_id"] ?? ""} onChange={(v) => setF((o) => ({ ...o, representante_party_id: v }))} disabled={!editar} placeholder="Escolha o representante" />
            </div>
            <div className="grid gap-1 text-xs font-semibold text-ledger-muted">Data do acerto
              <DateField value={deIso(f["data"] ?? "")} onChange={(d) => setF((o) => ({ ...o, data: paraIso(d) }))} disabled={!editar} />
            </div>
            {campo("praca", "Praça", "text")}
            {campo("responsavel_nome", "Quem rodou a praça (se não for o representante)", "text")}
          </section>

          <section className="rounded-xl border border-line-soft bg-surface-muted/40 p-4" aria-label="Dados da operação">
            <p className="flex items-center gap-2 text-sm font-semibold text-ledger-text"><Truck aria-hidden className="size-4 text-bronze" /> O que a operação Lardan registra perto dessa data</p>
            {op.isPending && op.fetchStatus !== "idle" ? <p className="mt-2 text-xs text-ledger-muted">Consultando remessas…</p>
              : op.isError ? <p className="mt-2 text-xs text-destructive">Não foi possível consultar as remessas.</p>
              : (op.data ?? []).length === 0 ? <p className="mt-2 text-xs text-ledger-muted">Nenhuma remessa deste representante com acerto entre 6 dias antes e 6 dias depois.</p>
              : (
                <ul className="mt-2 space-y-2 text-sm">
                  {(op.data ?? []).map((r) => (
                    <li key={r.remessa} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
                      <span><strong>Remessa {r.remessa}</strong> · {r.praca} · acerto {dataBR(r.data_acerto)}</span>
                      <span className="num text-xs text-ledger-muted">{r.maletas} maletas · enviado {brl(r.estoque_enviado_cents)} · {r.baixas_fechadas} baixas · vendido {brl(r.vendido_cents)}</span>
                      {editar && (
                        <button type="button" className="admin-btn h-8 px-3 text-xs" onClick={() => setF((o) => ({
                          ...o, praca: o["praca"] || r.praca, clientes_atendidas: o["clientes_atendidas"] || String(r.maletas),
                          estoque_enviado_cents: centsTexto(r.estoque_enviado_cents),
                          ...(r.vendido_cents > 0 && !o["venda_bruta_cents"] ? { venda_bruta_cents: centsTexto(r.vendido_cents) } : {}),
                        }))}>Usar estes números</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          <section className="grid gap-3 sm:grid-cols-4">{CAMPOS_NUM.map(([k, r]) => campo(k, r, "numeric"))}</section>
          <section className="grid gap-3 sm:grid-cols-3">{CAMPOS_DINHEIRO.map(([k, r]) => campo(k, `${r} (R$)`))}</section>
          <section>
            <p className="mb-2 text-sm font-semibold text-ledger-text">Gastos da viagem</p>
            <div className="grid gap-3 sm:grid-cols-4">{CAMPOS_GASTOS.map(([k, r]) => campo(k, `${r} (R$)`))}</div>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            {campo("retido_cents", calc.retido_automatico ? `Retido (R$) — vazio = automático ${brl(calc.retido_calc_cents)}` : "Retido (R$)")}
            {campo("desconto_pessoal_cents", "Desconto pessoal (R$)")}
            <label className="grid gap-1 text-xs font-semibold text-ledger-muted sm:col-span-2">Observações
              <textarea className="admin-input min-h-16 text-sm font-normal text-ledger-text" disabled={!editar} value={f["observacao"] ?? ""} onChange={set("observacao")} maxLength={2000} />
            </label>
          </section>

          <section className="rounded-xl border border-primary/30 bg-primary/5 p-4" aria-label="Cálculo do acerto" data-testid="calculo-acerto">
            <p className="text-sm font-semibold text-ledger-text">Cálculo ({calc.tabela ?? "sem tabela vigente"})</p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <Item t="% de recebimento" v={pct(calc.pct_recebimento)} />
              <Item t="Faixa" v={calc.faixa ? `${calc.faixa} · ${pct(calc.pct_comissao)}` : "—"} />
              <Item t="Comissão calculada" v={brl(calc.comissao_cents)} />
              <Item t="Diferença de pagamento" v={brl(calc.diferenca_cents)} />
              <Item t="Gastos" v={brl(calc.gastos_cents)} />
              <Item t="Retido" v={brl(calc.retido_calc_cents)} />
              <Item t="Carteira atual" v={String(calc.carteira)} />
              <Item t="Aproveitamento" v={pct(calc.aproveitamento, 2)} />
              <Item t="Ticket médio líquido" v={brl(calc.ticket_liquido_cents)} />
            </dl>
            <p className="mt-4 flex items-baseline justify-between border-t border-primary/20 pt-3">
              <span className="text-sm font-semibold text-ledger-text">Comissão livre a pagar</span>
              <strong className="num font-display text-2xl text-ledger-text">{brl(calc.livre_cents)}</strong>
            </p>
          </section>

          {editar && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              {f["id"] ? (
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <input className="admin-input h-10 min-w-56 flex-1" placeholder="Motivo para excluir (fica na auditoria)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <button type="button" className="admin-btn h-10 text-destructive" disabled={motivo.trim().length < 5 || excluir.isPending} onClick={() => excluir.mutate()}>
                    <Trash2 aria-hidden className="size-4" /> Excluir
                  </button>
                </div>
              ) : <span />}
              <button type="button" className="admin-btn admin-btn-primary h-11 px-6" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
                {salvar.isPending ? "Salvando…" : "Salvar acerto"}
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Item({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-primary/10 pb-1">
      <dt className="text-ledger-muted">{t}</dt>
      <dd className="num font-semibold text-ledger-text">{v}</dd>
    </div>
  );
}

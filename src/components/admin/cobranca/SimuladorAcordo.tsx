import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { DateField } from "@/components/premium/DateField";
import { brl, dataBR, hojeSP, cobConfig, simulacoes, salvarSimulacao, statusSimulacao, excluirSimulacao, comprovantes, ROTULO_SIMULACAO, type Parcela } from "@/lib/cobranca";
import { abrirComprovante } from "@/lib/cobranca.functions";
import { calcularEncargos, montarPlano, addMeses } from "@/lib/cobranca-acordo";
import { ComprovanteDialog } from "./ComprovanteDialog";

const iso = (d?: Date) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
const paraData = (s: string) => (s ? new Date(s + "T12:00:00") : undefined);
const reais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".") || 0) * 100);
const txt = (c: number) => (c / 100).toFixed(2).replace(".", ",");
type Linha = { numero: number; data: string; valor: string };

export function SimuladorAcordo({ partyId, parcelas }: { partyId: string; parcelas: Parcela[] }) {
  const qc = useQueryClient();
  const abrir = useServerFn(abrirComprovante);
  const cfg = useQuery({ queryKey: ["cob", "config"], queryFn: cobConfig });
  const hist = useQuery({ queryKey: ["cob", "sim", partyId], queryFn: () => simulacoes(partyId) });
  const comps = useQuery({ queryKey: ["cob", "comprovantes", partyId], queryFn: () => comprovantes(partyId) });
  const [sel, setSel] = React.useState<string[]>(() => parcelas.map((p) => p.installment_id));
  const [base, setBase] = React.useState(hojeSP());
  const [aplicar, setAplicar] = React.useState(true);
  const [multa, setMulta] = React.useState<number | null>(null);
  const [juros, setJuros] = React.useState<number | null>(null);
  const [desconto, setDesconto] = React.useState("");
  const [entrada, setEntrada] = React.useState("");
  const [entradaData, setEntradaData] = React.useState(hojeSP());
  const [n, setN] = React.useState(1);
  const [primeira, setPrimeira] = React.useState(addMeses(hojeSP(), 1));
  const [manual, setManual] = React.useState<Linha[] | null>(null);
  const [obs, setObs] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);
  const [comp, setComp] = React.useState<null | { simId: string | null; valor: number; ref: string }>(null);

  if (!cfg.data) return <p className="text-sm text-ledger-muted">Carregando encargos…</p>;
  const m = multa ?? cfg.data.multa_pct, j = juros ?? cfg.data.juros_mes_pct;
  const linhas = calcularEncargos(parcelas.filter((p) => sel.includes(p.installment_id)).map((p) => ({ ...p, saldo_cents: Number(p.saldo_cents) })), base, { multa_pct: m, juros_mes_pct: j, carencia_dias: cfg.data.carencia_dias }, aplicar);
  const principal = linhas.reduce((a, l) => a + l.principal, 0);
  const encargos = linhas.reduce((a, l) => a + l.multa + l.juros, 0);
  const desc = Math.min(reais(desconto), principal + encargos);
  const total = principal + encargos - desc;
  const ent = Math.min(reais(entrada), total);
  const auto: Linha[] = ent >= total ? [] : montarPlano(total, ent, n, primeira).map((p) => ({ numero: p.numero, data: p.data, valor: txt(p.valor_cents) }));
  const plano = manual ?? auto;
  const somaPlano = plano.reduce((a, p) => a + reais(p.valor), 0);
  const diferenca = total - ent - somaPlano;
  const reset = <T,>(f: (v: T) => void) => (v: T) => { f(v); setManual(null); };
  const editar = (i: number, campo: "data" | "valor", v: string) => setManual(plano.map((p, k) => (k === i ? { ...p, [campo]: v } : p)));

  const salvar = async () => {
    if (!linhas.length) { toast.error("Escolha ao menos uma parcela."); return; }
    if (diferenca !== 0) { toast.error(`Entrada + parcelas precisa fechar o total. Diferença: ${brl(diferenca)}.`); return; }
    setSalvando(true);
    try {
      const pl = plano.map((p, k) => ({ numero: k + 1, data: p.data, valor_cents: reais(p.valor) }));
      await salvarSimulacao(partyId, { installment_ids: sel, data_base: base, multa_pct: aplicar ? m : 0, juros_mes_pct: aplicar ? j : 0, principal_cents: principal, encargos_cents: encargos, desconto_cents: desc, total_cents: total, entrada_cents: ent, entrada_data: ent ? entradaData : "", parcelas: pl.length, primeira_data: pl[0]?.data ?? "", plano: pl, observacao: obs });
      toast.success(ent ? "Acordo salvo. Lembrete criado para o dia da entrada." : "Simulação salva.");
      setManual(null);
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não salvou."); } finally { setSalvando(false); }
  };
  const mudar = async (id: string, st: "efetivada" | "cancelada") => {
    const motivo = prompt(st === "efetivada" ? "Confirme: a entrada foi recebida? Descreva (ex.: Pix 14/10)" : "Motivo do cancelamento");
    if (!motivo) return;
    try { await statusSimulacao(id, st, motivo); qc.invalidateQueries({ queryKey: ["cob"] }); toast.success("Atualizado."); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); }
  };
  const excluir = async (id: string) => {
    const motivo = prompt("Excluir acordo digitado errado. Qual o motivo?");
    if (!motivo) return;
    try { await excluirSimulacao(id, motivo); qc.invalidateQueries({ queryKey: ["cob"] }); toast.success("Acordo excluído (fica no histórico como excluído)."); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); }
  };
  const verComp = async (id: string) => { try { const r = await abrir({ data: { id } }); window.open(r.url, "_blank", "noopener"); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } };
  const inp = "h-10 rounded-lg border border-line bg-surface px-3 text-sm";

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-line-soft bg-warm-ivory/60 p-3 text-xs text-ledger-muted">Simulação e acordo não mexem no financeiro. A dívida só muda pela baixa oficial quando o dinheiro entra.</p>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Calcular até<DateField value={paraData(base)} onChange={(d) => d && reset(setBase)(iso(d))} /></label>
            <label className="text-xs text-ledger-muted">Multa %<input type="number" step="0.1" value={m} onChange={(e) => reset(setMulta)(Number(e.target.value))} className={`${inp} block w-24`} disabled={!aplicar} /></label>
            <label className="text-xs text-ledger-muted">Juros % ao mês<input type="number" step="0.1" value={j} onChange={(e) => reset(setJuros)(Number(e.target.value))} className={`${inp} block w-24`} disabled={!aplicar} /></label>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={aplicar} onChange={(e) => reset(setAplicar)(e.target.checked)} />Cobrar encargos</label>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ledger-muted"><tr><th className="py-2"></th><th>Vencimento</th><th>Atraso</th><th className="text-right">Saldo</th><th className="text-right">Multa</th><th className="text-right">Juros</th><th className="text-right">Atualizado</th></tr></thead>
            <tbody>{parcelas.map((p) => { const l = linhas.find((x) => x.installment_id === p.installment_id); return (
              <tr key={p.installment_id} className="border-t border-line-soft">
                <td className="py-2"><input type="checkbox" aria-label={`Incluir parcela ${dataBR(p.vencimento)}`} checked={sel.includes(p.installment_id)} onChange={(e) => reset(setSel)(e.target.checked ? [...sel, p.installment_id] : sel.filter((x) => x !== p.installment_id))} /></td>
                <td>{dataBR(p.vencimento)}</td><td>{l?.dias ?? "—"} d</td>
                <td className="text-right font-mono">{brl(Number(p.saldo_cents))}</td>
                <td className="text-right font-mono">{l ? brl(l.multa) : "—"}</td><td className="text-right font-mono">{l ? brl(l.juros) : "—"}</td>
                <td className="text-right font-mono font-semibold">{l ? brl(l.total) : "—"}</td>
              </tr>); })}</tbody>
          </table>
        </section>
        <section className="space-y-3 rounded-xl border border-bronze/40 bg-surface p-5">
          <h3 className="font-semibold text-ledger-text">Proposta de acordo</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Saldo original</dt><dd className="font-mono">{brl(principal)}</dd></div>
            <div className="flex justify-between"><dt>Multa + juros</dt><dd className="font-mono">{brl(encargos)}</dd></div>
            <div className="flex items-center justify-between"><dt>Desconto (R$)</dt><dd><input value={desconto} onChange={(e) => reset(setDesconto)(e.target.value)} placeholder="0,00" className={`${inp} w-32 text-right`} /></dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total do acordo</dt><dd className="font-mono" data-testid="total-acordo">{brl(total)}</dd></div>
          </dl>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Entrada (R$)<input value={entrada} onChange={(e) => reset(setEntrada)(e.target.value)} placeholder="0,00" className={`${inp} block w-32`} /></label>
            <label className="text-xs text-ledger-muted">Data da entrada<DateField value={paraData(entradaData)} onChange={(d) => d && setEntradaData(iso(d))} /></label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Parcelas<input type="number" min={1} max={48} value={n} onChange={(e) => reset(setN)(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} className={`${inp} block w-20`} /></label>
            <label className="text-xs text-ledger-muted">1ª parcela<DateField value={paraData(primeira)} onChange={(d) => d && reset(setPrimeira)(iso(d))} /></label>
          </div>
          {plano.length > 0 && (
            <div className="space-y-2 rounded-lg border border-line-soft p-3">
              <div className="flex items-center justify-between text-xs text-ledger-muted"><span>Parcelas do acordo — data e valor editáveis</span>{manual && <button className="underline" onClick={() => setManual(null)}>Dividir igual de novo</button>}</div>
              <ul className="max-h-72 space-y-2 overflow-auto">{plano.map((p, i) => (
                <li key={i} className="flex items-center gap-2 text-sm"><span className="w-8 text-xs text-ledger-muted">{i + 1}ª</span>
                  <div className="flex-1"><DateField value={paraData(p.data)} onChange={(d) => d && editar(i, "data", iso(d))} /></div>
                  <input aria-label={`Valor da parcela ${i + 1}`} value={p.valor} onChange={(e) => editar(i, "valor", e.target.value)} className={`${inp} w-28 text-right font-mono`} />
                </li>))}</ul>
              <p className={`text-xs ${diferenca === 0 ? "text-success" : "text-danger"}`} data-testid="diferenca-acordo">{diferenca === 0 ? "Entrada + parcelas fecham o total." : `Falta ${diferenca > 0 ? "distribuir" : "tirar"} ${brl(Math.abs(diferenca))} para fechar o total.`}</p>
            </div>
          )}
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Observação" className="w-full rounded-lg border border-line bg-surface p-2 text-sm" />
          <button disabled={salvando || diferenca !== 0} onClick={salvar} className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{ent ? "Salvar acordo (aguarda entrada)" : "Salvar simulação"}</button>
        </section>
      </div>
      <section className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Simulações e acordos</h3>
          <button className="text-xs underline" onClick={() => setComp({ simId: null, valor: 0, ref: "parcela" })}>Anexar comprovante avulso</button></div>
        {(hist.data ?? []).length === 0 ? <p className="text-sm text-ledger-muted">Nenhuma simulação salva.</p> : hist.data!.map((s) => (
          <div key={s.id} className={`space-y-1 rounded-lg border border-line bg-surface p-3 text-sm ${s.status === "excluida" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{dataBR(s.created_at)} · total <b className="font-mono">{brl(Number(s.total_cents))}</b>{Number(s.desconto_cents) > 0 && ` (desc. ${brl(Number(s.desconto_cents))})`}{Number(s.entrada_cents) > 0 && ` · entrada ${brl(Number(s.entrada_cents))} em ${dataBR(s.entrada_data)}`} · {s.plano.length ? `${s.plano.length}x` : "à vista"} · <b>{ROTULO_SIMULACAO[s.status] ?? s.status}</b></span>
              <span className="flex gap-3 text-xs">
                {(s.status === "simulada" || s.status === "aguardando_entrada") && <>
                  {Number(s.entrada_cents) > 0 && <button className="underline" onClick={() => setComp({ simId: s.id, valor: Number(s.entrada_cents), ref: "entrada" })}>Anexar comprovante da entrada</button>}
                  <button className="underline" onClick={() => mudar(s.id, "efetivada")}>Entrada recebida</button>
                  <button className="underline" onClick={() => mudar(s.id, "cancelada")}>Cancelar</button>
                </>}
                {s.status !== "efetivada" && s.status !== "excluida" && <button className="text-danger underline" onClick={() => excluir(s.id)}>Excluir acordo</button>}
              </span>
            </div>
            {s.plano.length > 0 && <p className="text-xs text-ledger-muted">{s.plano.map((p) => `${p.numero}ª ${dataBR(p.data)} ${brl(p.valor_cents)}`).join(" · ")}</p>}
            {(comps.data ?? []).filter((c) => c.simulacao_id === s.id).map((c) => (
              <p key={c.id} className="text-xs">Comprovante {brl(Number(c.valor_cents))} em {dataBR(c.data_pagamento)}{c.banco && ` (${c.banco})`} · {c.status === "aguardando_baixa" ? "aguarda baixa no financeiro" : c.status} · <button className="underline" onClick={() => verComp(c.id)}>ver arquivo</button></p>
            ))}
          </div>
        ))}
        {(comps.data ?? []).filter((c) => !c.simulacao_id).map((c) => (
          <p key={c.id} className="rounded-lg border border-line-soft p-2 text-xs">Comprovante avulso {brl(Number(c.valor_cents))} em {dataBR(c.data_pagamento)}{c.banco && ` (${c.banco})`} · {c.status === "aguardando_baixa" ? "aguarda baixa no financeiro" : c.status} · <button className="underline" onClick={() => verComp(c.id)}>ver arquivo</button></p>
        ))}
      </section>
      <ComprovanteDialog open={!!comp} onOpenChange={(v) => !v && setComp(null)} partyId={partyId} simulacaoId={comp?.simId} referente={comp?.ref ?? "entrada"} valorSugerido={comp?.valor}
        onSalvo={() => qc.invalidateQueries({ queryKey: ["cob"] })} />
    </div>
  );
}

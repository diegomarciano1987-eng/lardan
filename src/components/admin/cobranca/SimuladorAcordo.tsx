import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DateField } from "@/components/premium/DateField";
import { brl, dataBR, hojeSP, cobConfig, simulacoes, salvarSimulacao, statusSimulacao, ROTULO_SIMULACAO, type Parcela } from "@/lib/cobranca";
import { calcularEncargos, montarPlano, addMeses } from "@/lib/cobranca-acordo";

const iso = (d?: Date) => (d ? d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "");
const paraData = (s: string) => (s ? new Date(s + "T12:00:00") : undefined);
const reais = (s: string) => Math.round(Number(s.replace(/\./g, "").replace(",", ".") || 0) * 100);

export function SimuladorAcordo({ partyId, parcelas }: { partyId: string; parcelas: Parcela[] }) {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["cob", "config"], queryFn: cobConfig });
  const hist = useQuery({ queryKey: ["cob", "sim", partyId], queryFn: () => simulacoes(partyId) });
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
  const [obs, setObs] = React.useState("");
  const [salvando, setSalvando] = React.useState(false);

  if (!cfg.data) return <p className="text-sm text-ledger-muted">Carregando encargos…</p>;
  const m = multa ?? cfg.data.multa_pct, j = juros ?? cfg.data.juros_mes_pct;
  const linhas = calcularEncargos(parcelas.filter((p) => sel.includes(p.installment_id)).map((p) => ({ ...p, saldo_cents: Number(p.saldo_cents) })), base, { multa_pct: m, juros_mes_pct: j, carencia_dias: cfg.data.carencia_dias }, aplicar);
  const principal = linhas.reduce((a, l) => a + l.principal, 0);
  const encargos = linhas.reduce((a, l) => a + l.multa + l.juros, 0);
  const desc = Math.min(reais(desconto), principal + encargos);
  const total = principal + encargos - desc;
  const ent = Math.min(reais(entrada), total);
  const plano = ent >= total ? [] : montarPlano(total, ent, n, primeira);

  const salvar = async () => {
    if (!linhas.length) { toast.error("Escolha ao menos uma parcela."); return; }
    setSalvando(true);
    try {
      await salvarSimulacao(partyId, { installment_ids: sel, data_base: base, multa_pct: aplicar ? m : 0, juros_mes_pct: aplicar ? j : 0, principal_cents: principal, encargos_cents: encargos, desconto_cents: desc, total_cents: total, entrada_cents: ent, entrada_data: ent ? entradaData : "", parcelas: n, primeira_data: plano.length ? primeira : "", plano, observacao: obs });
      toast.success(ent ? "Acordo salvo. Lembrete criado para o dia da entrada." : "Simulação salva.");
      qc.invalidateQueries({ queryKey: ["cob"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não salvou."); } finally { setSalvando(false); }
  };
  const mudar = async (id: string, st: "efetivada" | "cancelada") => {
    const motivo = prompt(st === "efetivada" ? "Confirme: a entrada foi recebida? Descreva (ex.: Pix 14/10)" : "Motivo do cancelamento");
    if (!motivo) return;
    try { await statusSimulacao(id, st, motivo); qc.invalidateQueries({ queryKey: ["cob"] }); toast.success("Atualizado."); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); }
  };
  const inp = "h-10 rounded-lg border border-line bg-surface px-3 text-sm";

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-line-soft bg-warm-ivory/60 p-3 text-xs text-ledger-muted">Simulação e acordo não mexem no financeiro. A dívida só muda pela baixa oficial quando o dinheiro entra.</p>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Calcular até<DateField value={paraData(base)} onChange={(d) => d && setBase(iso(d))} /></label>
            <label className="text-xs text-ledger-muted">Multa %<input type="number" step="0.1" value={m} onChange={(e) => setMulta(Number(e.target.value))} className={`${inp} block w-24`} disabled={!aplicar} /></label>
            <label className="text-xs text-ledger-muted">Juros % ao mês<input type="number" step="0.1" value={j} onChange={(e) => setJuros(Number(e.target.value))} className={`${inp} block w-24`} disabled={!aplicar} /></label>
            <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} />Cobrar encargos</label>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ledger-muted"><tr><th className="py-2"></th><th>Vencimento</th><th>Atraso</th><th className="text-right">Saldo</th><th className="text-right">Multa</th><th className="text-right">Juros</th><th className="text-right">Atualizado</th></tr></thead>
            <tbody>{parcelas.map((p) => { const l = linhas.find((x) => x.installment_id === p.installment_id); return (
              <tr key={p.installment_id} className="border-t border-line-soft">
                <td className="py-2"><input type="checkbox" aria-label={`Incluir parcela ${dataBR(p.vencimento)}`} checked={sel.includes(p.installment_id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.installment_id] : sel.filter((x) => x !== p.installment_id))} /></td>
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
            <div className="flex items-center justify-between"><dt>Desconto (R$)</dt><dd><input value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" className={`${inp} w-32 text-right`} /></dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total do acordo</dt><dd className="font-mono" data-testid="total-acordo">{brl(total)}</dd></div>
          </dl>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Entrada (R$)<input value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" className={`${inp} block w-32`} /></label>
            <label className="text-xs text-ledger-muted">Data da entrada<DateField value={paraData(entradaData)} onChange={(d) => d && setEntradaData(iso(d))} /></label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ledger-muted">Parcelas<input type="number" min={1} max={48} value={n} onChange={(e) => setN(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} className={`${inp} block w-20`} /></label>
            <label className="text-xs text-ledger-muted">1ª parcela<DateField value={paraData(primeira)} onChange={(d) => d && setPrimeira(iso(d))} /></label>
          </div>
          {plano.length > 0 && <ul className="max-h-40 overflow-auto rounded-lg border border-line-soft p-2 text-xs">{plano.map((p) => <li key={p.numero} className="flex justify-between py-0.5"><span>{p.numero}ª · {dataBR(p.data)}</span><span className="font-mono">{brl(p.valor_cents)}</span></li>)}</ul>}
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Observação" className="w-full rounded-lg border border-line bg-surface p-2 text-sm" />
          <button disabled={salvando} onClick={salvar} className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{ent ? "Salvar acordo (aguarda entrada)" : "Salvar simulação"}</button>
        </section>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Simulações e acordos</h3>
        {(hist.data ?? []).length === 0 ? <p className="text-sm text-ledger-muted">Nenhuma simulação salva.</p> : hist.data!.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3 text-sm">
            <span>{dataBR(s.created_at)} · total <b className="font-mono">{brl(Number(s.total_cents))}</b>{Number(s.desconto_cents) > 0 && ` (desc. ${brl(Number(s.desconto_cents))})`}{Number(s.entrada_cents) > 0 && ` · entrada ${brl(Number(s.entrada_cents))} em ${dataBR(s.entrada_data)}`} · {s.plano.length ? `${s.plano.length}x` : "à vista"} · <b>{ROTULO_SIMULACAO[s.status]}</b></span>
            {(s.status === "simulada" || s.status === "aguardando_entrada") && <span className="flex gap-3 text-xs"><button className="underline" onClick={() => mudar(s.id, "efetivada")}>Entrada recebida</button><button className="underline" onClick={() => mudar(s.id, "cancelada")}>Cancelar</button></span>}
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * 0149 — financeiro da consultora no SmallData, dentro do cockpit: como ela pagou cada acerto,
 * os fiados (abertos e quitados) e os pagamentos (boleto, depósito, cartão, cheque).
 * Somente leitura. O fiado aberto mostra se já existe título no Lardan.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { brl, dataBR, financeiroSmallData, type FinanceiroSmallData as Dados } from "@/lib/cobranca";

type Sub = "acertos" | "fiados" | "pagamentos";
const ORIGEM: Record<string, string> = { boleto: "Boleto", deposito: "Depósito", cartao: "Cartão", cheque: "Cheque" };

export function useFinanceiroSmallData(partyId: string) {
  return useQuery({ queryKey: ["cob", "smalldata-fin", partyId], queryFn: () => financeiroSmallData(partyId), staleTime: 5 * 60_000 });
}

/** Linha de números do SmallData para o topo do cockpit. */
export function ResumoSmallData({ d }: { d: Dados }) {
  const r = d.resumo;
  if (!d.codigos.length) return null;
  const Item = ({ t, v, alerta }: { t: string; v: string; alerta?: boolean }) => (
    <div className="rounded-xl border border-dashed border-border bg-card/60 p-3">
      <p className="text-[0.7rem] text-muted-foreground">{t}</p>
      <p className={`mt-0.5 font-mono text-base tabular-nums ${alerta ? "text-destructive" : ""}`}>{v}</p>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        Histórico SmallData · cliente {d.codigos.join(", ")} · {r.acertos} acertos
        {r.primeiro_acerto ? ` de ${dataBR(r.primeiro_acerto)} a ${dataBR(r.ultimo_acerto)}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <Item t="Vendeu (bruto)" v={brl(Number(r.venda_bruta_cents))} />
        <Item t="Pagou nos acertos" v={brl(Number(r.total_pago_cents))} />
        <Item t="Fiado gerado" v={brl(Number(r.fiado_gerado_cents))} />
        <Item t="Fiado quitado" v={brl(Number(r.fiado_quitado_cents))} />
        <Item t={`Fiado em aberto (${r.fiado_aberto_parcelas})`} v={brl(Number(r.fiado_aberto_cents))} alerta={Number(r.fiado_vencido_cents) > 0} />
        <Item t="Aberto sem título no Lardan" v={brl(Number(r.fiado_aberto_sem_lardan_cents))} alerta={Number(r.fiado_aberto_sem_lardan_cents) > 0} />
      </div>
    </div>
  );
}

export function FinanceiroSmallData({ d }: { d: Dados }) {
  const [sub, setSub] = React.useState<Sub>("acertos");
  if (!d.codigos.length)
    return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Esta pessoa não está ligada a nenhum código de cliente do SmallData.</p>;
  if (!d.acertos.length && !d.fiados.length && !d.pagamentos.length)
    return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Ligada ao cliente {d.codigos.join(", ")}, mas o financeiro do SmallData ainda não foi importado (cobrancas.csv, fiados.csv, pagamentos.csv).</p>;
  const r = d.resumo;
  const m = (c: number) => <span className="font-mono tabular-nums">{c ? brl(Number(c)) : "—"}</span>;
  const Tabela = ({ cab, linhas }: { cab: string[]; linhas: React.ReactNode[][] }) => (
    <div className="overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{cab.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i} className="border-t border-border">{l.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Formas de pagamento no SmallData: dinheiro {brl(Number(r.dinheiro_cents))} · depósito {brl(Number(r.deposito_cents))} · cartão {brl(Number(r.cartao_cents))} ·
        cheque {brl(Number(r.cheque_cents))} · boleto {brl(Number(r.boleto_cents))}{Number(r.desconto_cents) ? ` · descontos ${brl(Number(r.desconto_cents))}` : ""}.
        Somente leitura: o que vale para cobrar hoje são os débitos do Lardan.
      </p>
      <div className="flex flex-wrap gap-1">
        {([["acertos", `Acertos e cobranças (${d.acertos.length})`], ["fiados", `Fiados (${d.fiados.length})`], ["pagamentos", `Pagamentos (${d.pagamentos.length})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${sub === k ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      {sub === "acertos" && <Tabela cab={["Data", "Lançamento", "Remessa", "Venda bruta", "Venda líquida", "Pagou", "Dinheiro", "Depósito", "Cartão", "Cheque", "Boleto", "Fiado pago", "Virou fiado"]}
        linhas={d.acertos.map((a) => [dataBR(a.data), a.rotulo, a.remessa ?? "—", m(a.venda_bruta_cents), m(a.venda_liquida_cents), m(a.total_pago_cents),
          m(a.dinheiro_cents), m(a.deposito_cents), m(a.cartao_cents), m(a.cheque_cents), m(a.boleto_cents), m(a.fiado_pago_cents), m(a.fiado_novo_cents)])} />}
      {sub === "fiados" && <Tabela cab={["Situação", "Parcela", "Cobrança", "Vencimento", "Valor", "Juros/multa", "Forma", "Pago em", "No Lardan"]}
        linhas={d.fiados.map((f) => [
          f.situacao === "aberto" ? <span className={f.atraso ? "font-medium text-destructive" : "font-medium"}>{f.atraso ? `Aberto · ${f.atraso} dias` : "Aberto"}</span> : <span className="text-muted-foreground">Quitado</span>,
          f.parcela ?? "—", dataBR(f.data_cob), dataBR(f.vencimento), m(f.valor_cents), m(f.juros_cents), f.forma ?? "—", dataBR(f.data_pgto),
          f.situacao === "aberto" ? (f.no_lardan ? "Título no Lardan" : <span className="text-warning">Sem título</span>) : "—"])} />}
      {sub === "pagamentos" && <Tabela cab={["Data", "Forma", "Valor", "Pago", "Taxa", "Parcela", "Vencimento", "Situação"]}
        linhas={d.pagamentos.map((p) => [dataBR(p.data), ORIGEM[p.origem] ?? p.origem, m(p.valor_cents), m(p.valor_pago_cents), m(p.taxa_cents),
          p.parcelas ? `${p.parcela ?? "?"}/${p.parcelas}` : (p.parcela ?? "—"), dataBR(p.vencimento),
          p.situacao === "devolvido" ? <span className="text-destructive">Devolvido em {dataBR(p.data_devolucao)}</span> : (p.situacao ?? "—")])} />}
    </div>
  );
}

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { cockpitFinanceiro, brl, dataBR, hojeSP, rotuloEtapa } from "@/lib/cobranca";

type Aba = "abertas" | "fiado" | "recebimentos" | "comissoes" | "maletas";
const SIT: Record<string, string> = { nao_liquidado: "Em aberto", parcial: "Parcial", liquidado: "Pago", excedente: "Pago a mais" };

/** Rastro financeiro completo da consultora: débitos, fiado (lastro da planilha), pagamentos, comissões e maletas. */
export function CockpitFinanceiroConsultora({ partyId }: { partyId: string }) {
  const q = useQuery({ queryKey: ["cob", "cockpit-fin", partyId], queryFn: () => cockpitFinanceiro(partyId) });
  const [aba, setAba] = React.useState<Aba>("abertas");
  if (q.isLoading) return <p className="p-5 text-sm text-muted-foreground">Carregando o financeiro…</p>;
  if (q.error) return <p className="p-5 text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data!;
  const r = d.resumo;
  const hoje = hojeSP();
  const Kpi = ({ t, v, alerta }: { t: string; v: string; alerta?: boolean }) => (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{t}</p>
      <p className={`mt-1 font-mono text-lg tabular-nums ${alerta ? "text-destructive" : ""}`}>{v}</p>
    </div>
  );
  const vazio = (t: string) => <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t}</p>;
  const Tabela = ({ cab, linhas }: { cab: string[]; linhas: React.ReactNode[][] }) => (
    <div className="overflow-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{cab.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i} className="border-t border-border">{l.map((c, j) => <td key={j} className="px-4 py-3">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi t="Vencido" v={brl(Number(r.vencido_cents))} alerta={Number(r.vencido_cents) > 0} />
        <Kpi t="A vencer" v={brl(Number(r.a_vencer_cents))} />
        <Kpi t="Parcelas em aberto" v={String(r.parcelas_abertas)} />
        <Kpi t="Maior atraso" v={`${r.maior_atraso} dias`} />
        <Kpi t="Já pagou (baixas reais)" v={brl(Number(r.recebido_cents))} />
        <Kpi t="Comissões de indicação" v={brl(Number(r.comissao_cents))} />
      </div>
      <p className="text-xs text-muted-foreground">
        Praça: <b>{r.praca ? `${r.praca.codigo} · ${r.praca.nome}` : "Não informada"}</b> · Representante: <b>{r.representante ?? "Não informado"}</b> · Código do cliente: <b>{r.codigo_legado ?? "Não informado"}</b>
        {r.etapa_cobranca && <> · Cobrança: <b>{rotuloEtapa(r.etapa_cobranca)}</b></>}
      </p>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {([["abertas", `Débitos em aberto (${d.parcelas.length})`], ["fiado", `Fiado — lastro (${d.fiado.length})`], ["recebimentos", `Pagamentos (${d.recebimentos.length})`], ["comissoes", `Comissões (${d.comissoes.length})`], ["maletas", `Maletas (${d.maletas.length})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} className={`border-b-2 px-4 py-2 text-sm ${aba === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      {aba === "abertas" && (d.parcelas.length ? <Tabela cab={["Título", "Descrição", "Origem", "Vencimento", "Valor", "Saldo", "Atraso"]} linhas={d.parcelas.map((p) => [
        p.numero ?? "—", p.descricao, p.origem === "fiado_historico" ? "Fiado" : p.origem ?? "Manual",
        <span className={p.vencimento < hoje ? "text-destructive" : ""}>{dataBR(p.vencimento)}</span>,
        <span className="font-mono tabular-nums">{brl(Number(p.valor_cents))}</span>, <span className="font-mono tabular-nums">{brl(Number(p.saldo_cents))}</span>,
        p.atraso ? `${p.atraso} dias` : "—"])} /> : vazio("Sem débitos em aberto."))}
      {aba === "fiado" && (d.fiado.length ? <>
        <p className="text-xs text-muted-foreground">Cada linha é a linha original da planilha de fiados, guardada sem alteração e ligada ao título a receber que ela gerou.</p>
        <Tabela cab={["Lote / linha", "Data da cobrança", "Vencimento", "Parcela", "Valor", "Situação hoje"]} linhas={d.fiado.map((f) => [
          `${f.lote} · ${f.linha}`, dataBR(f.data_cobranca), dataBR(f.vencimento), String(f.parcela),
          <span className="font-mono tabular-nums">{brl(Number(f.valor_cents))}</span>, SIT[f.situacao_titulo ?? ""] ?? "—"])} />
      </> : vazio("Sem fiado importado para esta pessoa."))}
      {aba === "recebimentos" && (d.recebimentos.length ? <Tabela cab={["Data", "Título", "Referência", "Valor"]} linhas={d.recebimentos.map((x) => [
        dataBR(x.data), x.titulo ?? "—", x.referencia ?? "—",
        <span className={`font-mono tabular-nums ${x.estorno ? "text-destructive" : ""}`}>{x.estorno ? "− " : ""}{brl(Number(x.valor_cents))}</span>])} /> : vazio("Sem pagamentos registrados."))}
      {aba === "comissoes" && (d.comissoes.length ? <Tabela cab={["Data", "Indicada", "Venda da maleta", "%", "Comissão", "Situação"]} linhas={d.comissoes.map((c) => [
        dataBR(c.data), c.indicada ?? "—", <span className="font-mono tabular-nums">{brl(Number(c.venda_cents))}</span>, `${c.percentual}%`,
        <span className="font-mono tabular-nums">{brl(Number(c.comissao_cents))}</span>, c.status])} /> : vazio("Sem comissões de indicação."))}
      {aba === "maletas" && (d.maletas.length ? <Tabela cab={["Ciclo", "Situação", "Peças", "Valor de referência", "Recebida", "Fechada"]} linhas={d.maletas.map((m) => [
        String(m.ciclo), m.status, String(m.pecas ?? "—"), <span className="font-mono tabular-nums">{m.valor_cents != null ? brl(Number(m.valor_cents)) : "—"}</span>,
        dataBR(m.recebida), dataBR(m.fechada)])} /> : vazio("Sem maletas."))}
    </div>
  );
}

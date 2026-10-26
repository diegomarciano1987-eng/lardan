import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { cockpitFinanceiro, notasEFechamentos, brl, dataBR, hojeSP, rotuloEtapa } from "@/lib/cobranca";
import { CobrarParcelaAsaas } from "@/components/admin/financeiro/CobrarParcelaAsaas";
import { FinanceiroSmallData, ResumoSmallData, useFinanceiroSmallData } from "./FinanceiroSmallData";

type Aba = "abertas" | "fiado" | "recebimentos" | "comissoes" | "maletas" | "fechamentos" | "notas" | "smalldata";
const TIPO_NF: Record<string, string> = { remessa: "Remessa", devolucao: "Devolução", venda: "Venda", perda: "Perda", retorno: "Retorno", acrescimo: "Acréscimo", devolucao_simbolica: "Devolução simbólica" };
const SIT_FECH: Record<string, string> = { fechada: "Fechada", aberta: "Na rua", perdida: "Perdida", encerrada: "Acerto encerrado", pendencia: "Com pendência",
  aguardando_pagamento: "Fechada · falta pagar", aguardando_conferencia: "Paga · falta conferir", aberta_app: "Lançando", operacao: "Na rua", recebida: "Na rua", acerto: "Em acerto", expedida: "Enviada", transito: "Em trânsito" };
const SIT_NF: Record<string, string> = { autorizada: "Autorizada", autorizado: "Autorizada", cancelada: "Cancelada", inutilizada: "Inutilizada", sem_retorno: "Sem retorno" };
const SIT: Record<string, string> = { nao_liquidado: "Em aberto", parcial: "Parcial", liquidado: "Pago", excedente: "Pago a mais" };

/** Rastro financeiro completo da consultora: débitos, fiado (lastro da planilha), pagamentos, comissões e maletas. */
export function CockpitFinanceiroConsultora({ partyId }: { partyId: string }) {
  const q = useQuery({ queryKey: ["cob", "cockpit-fin", partyId], queryFn: () => cockpitFinanceiro(partyId) });
  const sd = useFinanceiroSmallData(partyId);
  const nf = useQuery({ queryKey: ["cob", "notas-fechamentos", partyId], queryFn: () => notasEFechamentos(partyId) });
  const [aba, setAba] = React.useState<Aba | null>(null);
  if (q.isLoading) return <p className="p-5 text-sm text-muted-foreground">Carregando o financeiro…</p>;
  if (q.error) return <p className="p-5 text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data!;
  const r = d.resumo;
  // sem nada no Lardan e com histórico no SmallData: abre direto no SmallData (0149)
  const lardanVazio = !d.parcelas.length && !d.fiado.length && !d.recebimentos.length && !d.maletas.length;
  // sem débito em aberto: abre direto nos fechamentos (0161); sem nada no Lardan e com histórico no SmallData: SmallData (0149)
  const abaAtual: Aba = aba ?? (d.parcelas.length ? "abertas"
    : (nf.data?.fechamentos.length ?? 0) > 0 ? "fechamentos"
    : lardanVazio && (sd.data?.acertos.length ?? 0) > 0 ? "smalldata" : "abertas");
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
      {sd.data && <ResumoSmallData d={sd.data} />}
      <p className="text-xs text-muted-foreground">
        Praça: <b>{r.praca ? `${r.praca.codigo} · ${r.praca.nome}` : "Não informada"}</b> · Representante: <b>{r.representante ?? "Não informado"}</b> · Código do cliente: <b>{r.codigo_legado ?? "Não informado"}</b>
        {r.etapa_cobranca && <> · Cobrança: <b>{rotuloEtapa(r.etapa_cobranca)}</b></>}
      </p>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {([["abertas", `Débitos em aberto (${d.parcelas.length})`], ["fiado", `Fiado — lastro (${d.fiado.length})`], ["recebimentos", `Pagamentos (${d.recebimentos.length})`], ["comissoes", `Comissões (${d.comissoes.length})`], ["maletas", `Maletas (${d.maletas.length})`], ["fechamentos", `Fechamentos (${nf.data ? nf.data.fechamentos.length : "…"})`], ["notas", `Notas fiscais (${nf.data ? nf.data.notas.length : "…"})`], ["smalldata", `SmallData (${sd.data ? sd.data.acertos.length + sd.data.fiados.length : "…"})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)} className={`border-b-2 px-4 py-2 text-sm ${abaAtual === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      {abaAtual === "abertas" && (d.parcelas.length ? <Tabela cab={["Título", "Descrição", "Origem", "Vencimento", "Valor", "Saldo", "Atraso", "Asaas"]} linhas={d.parcelas.map((p) => [
        p.numero ?? "—", p.descricao, p.origem === "fiado_historico" ? "Fiado" : p.origem ?? "Manual",
        <span className={p.vencimento < hoje ? "text-destructive" : ""}>{dataBR(p.vencimento)}</span>,
        <span className="font-mono tabular-nums">{brl(Number(p.valor_cents))}</span>, <span className="font-mono tabular-nums">{brl(Number(p.saldo_cents))}</span>,
        p.atraso ? `${p.atraso} dias` : "—",
        <CobrarParcelaAsaas installmentId={p.installment_id} saldoCents={Number(p.saldo_cents)} vencimento={p.vencimento} compacto />])} /> : vazio("Sem débitos em aberto."))}
      {abaAtual === "fiado" && (d.fiado.length ? <>
        <p className="text-xs text-muted-foreground">Cada linha é a linha original da planilha de fiados, guardada sem alteração e ligada ao título a receber que ela gerou.</p>
        <Tabela cab={["Lote / linha", "Data da cobrança", "Vencimento", "Parcela", "Valor", "Situação hoje"]} linhas={d.fiado.map((f) => [
          `${f.lote} · ${f.linha}`, dataBR(f.data_cobranca), dataBR(f.vencimento), String(f.parcela),
          <span className="font-mono tabular-nums">{brl(Number(f.valor_cents))}</span>, SIT[f.situacao_titulo ?? ""] ?? "—"])} />
      </> : vazio("Sem fiado importado para esta pessoa."))}
      {abaAtual === "recebimentos" && (d.recebimentos.length ? <Tabela cab={["Data", "Título", "Referência", "Valor"]} linhas={d.recebimentos.map((x) => [
        dataBR(x.data), x.titulo ?? "—", x.referencia ?? "—",
        <span className={`font-mono tabular-nums ${x.estorno ? "text-destructive" : ""}`}>{x.estorno ? "− " : ""}{brl(Number(x.valor_cents))}</span>])} /> : vazio("Sem pagamentos registrados."))}
      {abaAtual === "comissoes" && (d.comissoes.length ? <Tabela cab={["Data", "Indicada", "Venda da maleta", "%", "Comissão", "Situação"]} linhas={d.comissoes.map((c) => [
        dataBR(c.data), c.indicada ?? "—", <span className="font-mono tabular-nums">{brl(Number(c.venda_cents))}</span>, `${c.percentual}%`,
        <span className="font-mono tabular-nums">{brl(Number(c.comissao_cents))}</span>, c.status])} /> : vazio("Sem comissões de indicação."))}
      {abaAtual === "smalldata" && (sd.isLoading ? <p className="p-5 text-sm text-muted-foreground">Carregando o histórico do SmallData…</p>
        : sd.error ? <p className="p-5 text-sm text-destructive">{(sd.error as Error).message}</p>
        : sd.data ? <FinanceiroSmallData d={sd.data} /> : null)}
      {(abaAtual === "fechamentos" || abaAtual === "notas") && (nf.isLoading ? <p className="p-5 text-sm text-muted-foreground">Carregando notas e fechamentos…</p>
        : nf.error ? <p className="p-5 text-sm text-destructive">{(nf.error as Error).message}</p> : null)}
      {abaAtual === "fechamentos" && nf.data && (nf.data.fechamentos.length ? <>
        <p className="text-xs text-muted-foreground">Cada maleta que ela recebeu, do SmallData e da Lardan: o que foi, o que voltou, o que vendeu, o acerto e as notas.</p>
        <Tabela cab={["Origem", "Remessa / maleta", "Enviada", "Fechamento", "Situação", "Peças env. / dev. / vend.", "Enviado", "Vendido", "Comissão", "A pagar / pago", "Notas"]} linhas={nf.data.fechamentos.map((f) => [
          f.origem === "lardan" ? "Lardan" : "SmallData",
          <span>{f.remessa ?? "—"} · {f.maleta}</span>,
          dataBR(f.enviada), dataBR(f.fechamento),
          <span className={f.acerto_divergente ? "text-destructive" : ""}>{SIT_FECH[f.situacao] ?? f.situacao}{f.acerto_divergente ? " · divergente" : ""}{f.sem_cobranca ? " · sem cobrança" : ""}</span>,
          <span className="font-mono tabular-nums">{f.pecas_enviadas ?? "—"} / {f.pecas_devolvidas ?? "—"} / {f.pecas_vendidas ?? "—"}</span>,
          <span className="font-mono tabular-nums">{f.valor_enviado_cents != null ? brl(Number(f.valor_enviado_cents)) : "—"}</span>,
          <span className="font-mono tabular-nums">{f.vendido_cents != null ? brl(Number(f.vendido_cents)) : "—"}</span>,
          <span className="font-mono tabular-nums">{f.cobranca?.comissao_cents != null ? brl(Number(f.cobranca.comissao_cents)) : "—"}</span>,
          <span className="font-mono tabular-nums">{f.cobranca?.venda_liquida_cents != null ? brl(Number(f.cobranca.venda_liquida_cents)) : "—"}{f.cobranca?.pago_cents != null ? ` / ${brl(Number(f.cobranca.pago_cents))}` : ""}</span>,
          Object.entries(f.notas ?? {}).map(([k, v]) => `${TIPO_NF[k] ?? k} ${v}`).join(" · ") || "—"])} />
      </> : vazio("Nenhum fechamento de maleta encontrado."))}
      {abaAtual === "notas" && nf.data && (nf.data.notas.length ? <>
        <p className="text-xs text-muted-foreground">Todas as notas fiscais lançadas contra ela, do SmallData e da Lardan, inclusive as canceladas.</p>
        <Tabela cab={["Origem", "Data", "Número / série", "Tipo", "CFOP", "Remessa / maleta", "Peças", "Valor", "Situação"]} linhas={nf.data.notas.map((n) => [
          n.origem === "lardan" ? `Lardan${n.simulada ? " (simulada)" : ""}` : "SmallData",
          n.data ? new Date(n.data).toLocaleDateString("pt-BR") : "—",
          `${n.numero ?? "—"}${n.serie ? ` / ${n.serie}` : ""}`,
          TIPO_NF[n.tipo] ?? n.natureza ?? n.tipo,
          n.cfop ?? "—",
          `${n.remessa ?? "—"}${n.maleta ? ` · ${n.maleta}` : ""}`,
          n.pecas ?? "—",
          <span className={`font-mono tabular-nums ${n.situacao === "cancelada" ? "line-through text-muted-foreground" : ""}`}>{brl(Number(n.valor_cents))}</span>,
          <span className={n.situacao === "cancelada" ? "text-destructive" : ""}>{SIT_NF[n.situacao ?? ""] ?? n.situacao ?? "—"}</span>])} />
      </> : vazio("Nenhuma nota fiscal encontrada para ela."))}
      {abaAtual === "maletas" && (d.maletas.length ? <Tabela cab={["Ciclo", "Situação", "Peças", "Valor de referência", "Recebida", "Fechada"]} linhas={d.maletas.map((m) => [
        String(m.ciclo), m.status, String(m.pecas ?? "—"), <span className="font-mono tabular-nums">{m.valor_cents != null ? brl(Number(m.valor_cents)) : "—"}</span>,
        dataBR(m.recebida), dataBR(m.fechada)])} /> : vazio("Sem maletas."))}
    </div>
  );
}

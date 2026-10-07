import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ErrorState, Panel, Skeleton, formatBRLFromCents, formatInt } from "@/components/admin/ui";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { AreaFinanceiraGuard } from "@/components/admin/financeiro/FinanceiroShell";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import { ListaTitulos } from "@/components/admin/financeiro/ListaTitulos";
import { TituloSheet } from "@/components/admin/financeiro/TituloSheet";
import { CobrarParcelaAsaas } from "@/components/admin/financeiro/CobrarParcelaAsaas";
import { CobrancaAsaasSheet, ConferenciaAsaas, useSincronizacaoDiariaAsaas } from "@/components/admin/financeiro/AsaasConferencia";
import { useCapabilities } from "@/lib/capabilities";
import {
  fetchLiquidacoes,
  fetchPagarReceber,
  fetchUltimaSyncAsaas,
  type LinhaPR,
  type Natureza,
} from "@/lib/financeiro-unificado";
import { sincronizarCobrancasAsaas } from "@/lib/asaas/espelho.functions";

export interface BuscaPR {
  de?: string;
  ate?: string;
  natureza?: Natureza;
  situacao?: string;
  origem?: string;
  busca?: string;
  pagina?: number;
  visao?: "parcela" | "titulo" | "liquidacoes";
}

type PatchPR = { [K in keyof BuscaPR]?: BuscaPR[K] | undefined };

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const validarBuscaPR = (s: Record<string, unknown>): BuscaPR => {
  const out: BuscaPR = {};
  const de = str(s["de"]);
  const ate = str(s["ate"]);
  if (de) out.de = de;
  if (ate) out.ate = ate;
  if (s["natureza"] === "receber" || s["natureza"] === "pagar") out.natureza = s["natureza"];
  const sit = str(s["situacao"]);
  if (sit && ["aberto", "vencido", "quitado", "a_vincular"].includes(sit)) out.situacao = sit;
  const ori = str(s["origem"]);
  if (ori && ["asaas", "importacao", "manual"].includes(ori)) out.origem = ori;
  const b = str(s["busca"]);
  if (b) out.busca = b.slice(0, 120);
  const p = Number(s["pagina"]);
  if (Number.isInteger(p) && p > 0) out.pagina = p;
  if (s["visao"] === "titulo" || s["visao"] === "liquidacoes") out.visao = s["visao"];
  return out;
};

export const Route = createFileRoute("/_authenticated/admin/financeiro/pagar-receber")({
  component: PagarReceber,
  validateSearch: validarBuscaPR,
  head: () => ({ meta: [{ title: "Pagar e receber — Financeiro LARDAN" }] }),
});

const POR = 50;
const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");
const mesBR = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

const ROTULO_SIT: Record<string, string> = {
  aberto: "Em aberto",
  vencido: "Vencida",
  quitado: "Quitada",
  a_vincular: "A vincular",
  recebido_asaas: "Recebido no Asaas",
};

function EtiquetaOrigem({ origem }: { origem: string }) {
  const cls =
    origem === "asaas"
      ? "bg-asaas text-asaas-foreground"
      : origem === "importacao"
        ? "bg-cream-2 text-ledger-text border border-line-soft"
        : "bg-surface text-ledger-muted border border-line-soft";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-bold tracking-wide uppercase ${cls}`}>
      {origem === "asaas" ? "Asaas" : origem === "importacao" ? "Importação" : "Manual"}
    </span>
  );
}

function PagarReceber() {
  const s = Route.useSearch();
  const navigate = useNavigate();
  const caps = useCapabilities();
  const { de, ate } = usePeriodoFinanceiro();
  const natureza: Natureza = s.natureza ?? "todos";
  const pagina = s.pagina ?? 1;
  const visao = s.visao ?? "parcela";
  const [busca, setBusca] = React.useState(s.busca ?? "");

  const ir = (patch: PatchPR, resetPagina = true) =>
    void navigate({
      to: "/admin/financeiro/pagar-receber",
      search: (prev: BuscaPR) => {
        const n = { ...prev, ...patch } as PatchPR;
        if (resetPagina && !("pagina" in patch)) delete n.pagina;
        (Object.keys(n) as (keyof BuscaPR)[]).forEach((k) => {
          if (n[k] === undefined || n[k] === "" || n[k] === "todos" || n[k] === "todas") delete n[k];
        });
        if (n.visao === "parcela") delete n.visao;
        return n as BuscaPR;
      },
      replace: true,
    });

  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((s.busca ?? "") !== busca) ir({ busca: busca || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const podeRec = caps.includes("finance.receivable.view");
  const podePag = caps.includes("finance.payable.view");
  const naturezas: { v: Natureza; r: string }[] = [
    ...(podeRec && podePag ? [{ v: "todos" as const, r: "Todos" }] : []),
    ...(podeRec ? [{ v: "receber" as const, r: "A receber" }] : []),
    ...(podePag ? [{ v: "pagar" as const, r: "A pagar" }] : []),
  ];

  return (
    <AreaFinanceiraGuard capacidade={podeRec ? "finance.receivable.view" : "finance.payable.view"}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Natureza" className="inline-flex rounded-[12px] border border-line bg-surface p-1">
            {naturezas.map((n) => (
              <button
                key={n.v}
                type="button"
                role="tab"
                aria-selected={natureza === n.v}
                onClick={() => ir({ natureza: n.v, ...(n.v === "todos" && visao === "titulo" ? { visao: undefined } : {}) })}
                className={`min-h-10 rounded-[9px] px-4 text-sm font-semibold ${natureza === n.v ? "bg-ledger-text text-surface" : "text-ledger-text"}`}
              >
                {n.r}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Unidade" className="inline-flex rounded-[12px] border border-line bg-surface p-1">
            {(
              [
                ["parcela", "Por parcela"],
                ...(natureza !== "todos" ? [["titulo", "Por título"]] : []),
                ...(natureza !== "todos" ? [["liquidacoes", natureza === "pagar" ? "Pagamentos" : "Recebimentos"]] : []),
              ] as [BuscaPR["visao"], string][]
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={visao === v}
                onClick={() => ir({ visao: v })}
                className={`min-h-10 rounded-[9px] px-4 text-sm font-semibold ${visao === v ? "bg-ledger-text text-surface" : "text-ledger-text"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {visao === "titulo" && natureza !== "todos" ? (
          <ListaTitulos
            direction={natureza === "pagar" ? "payable" : "receivable"}
            buscaInicial={s.busca ?? ""}
            situacaoInicial="todos"
            onFiltrosChange={(f) => ir({ busca: f.busca || undefined })}
          />
        ) : visao === "liquidacoes" && natureza !== "todos" ? (
          <ListaLiquidacoes direction={natureza === "pagar" ? "payable" : "receivable"} de={de} ate={ate} pagina={pagina} onPagina={(p) => ir({ pagina: p }, false)} />
        ) : (
          <>
            {s.origem === "asaas" && podeRec ? (
              <>
                <PainelAsaas de={de} ate={ate} />
                <ConferenciaAsaas />
              </>
            ) : null}
            <ListaUnificada
              filtros={{ natureza, de: s.busca ? "2000-01-01" : de, ate: s.busca ? "2099-12-31" : ate, situacao: s.situacao ?? "todos", origem: s.origem ?? "todas", busca: s.busca ?? "", limit: POR, offset: (pagina - 1) * POR }}
              busca={busca}
              setBusca={setBusca}
              onFiltro={ir}
              pagina={pagina}
            />
          </>
        )}
      </div>
    </AreaFinanceiraGuard>
  );
}

function ListaUnificada({
  filtros,
  busca,
  setBusca,
  onFiltro,
  pagina,
}: {
  filtros: Parameters<typeof fetchPagarReceber>[0];
  busca: string;
  setBusca: (v: string) => void;
  onFiltro: (p: PatchPR, reset?: boolean) => void;
  pagina: number;
}) {
  const q = useQuery({
    queryKey: ["fin-pagar-receber", filtros],
    queryFn: () => fetchPagarReceber(filtros),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const t = d?.totais;
  const paginas = t ? Math.max(1, Math.ceil(t.linhas / POR)) : 1;
  const caps = useCapabilities();
  const podeBaixar = caps.includes("finance.settlement.create");
  const [aberto, setAberto] = React.useState<{ titulo: string; parcela: string | null; baixa: boolean } | null>(null);
  const [cobranca, setCobranca] = React.useState<LinhaPR | null>(null);
  const abrir = (r: LinhaPR, baixa = false) => {
    if (r.tipo === "cobranca_asaas") setCobranca(r);
    else if (r.title_id) setAberto({ titulo: r.title_id, parcela: r.id, baixa });
  };

  return (
    <Panel flush>
      <TituloSheet
        id={aberto?.titulo ?? null}
        parcelaInicial={aberto?.parcela ?? null}
        focoBaixa={aberto?.baixa ?? false}
        onOpenChange={(v) => {
          if (!v) {
            setAberto(null);
            void q.refetch();
          }
        }}
      />
      <CobrancaAsaasSheet linha={cobranca} onOpenChange={(v) => !v && setCobranca(null)} />
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por descrição, pessoa, número ou ID Asaas"
          className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-base sm:w-80 sm:text-sm"
          aria-label="Buscar"
        />
        <SmartSelect
          options={[
            { value: "todos", label: "Todas as situações" },
            { value: "aberto", label: "Em aberto (inclui vencidas)" },
            { value: "vencido", label: "Vencidas" },
            { value: "quitado", label: "Quitadas" },
            { value: "a_vincular", label: "Cobranças Asaas sem vínculo" },
          ]}
          value={filtros.situacao}
          onChange={(v) => onFiltro({ situacao: v })}
          className="w-full sm:w-56"
        />
        <SmartSelect
          options={[
            { value: "todas", label: "Todas as origens" },
            { value: "asaas", label: "Asaas" },
            { value: "importacao", label: "Importação" },
            { value: "manual", label: "Manual" },
          ]}
          value={filtros.origem}
          onChange={(v) => onFiltro({ origem: v })}
          className="w-full sm:w-48"
        />
      </div>

      {q.isLoading ? <Skeleton className="m-5 h-40" /> : null}
      {q.error ? (
        <div className="p-5">
          <ErrorState message={`Não foi possível carregar: ${(q.error as Error).message}`} />
          <button type="button" className="admin-btn mt-3" onClick={() => void q.refetch()}>
            Tentar de novo
          </button>
        </div>
      ) : null}

      {d && t ? (
        <>
          <div className="grid gap-3 px-5 pt-4 sm:grid-cols-3">
            {filtros.natureza !== "pagar" ? (
              <Total rotulo="A receber" qtd={t.receber.qtd} valor={t.receber.valor_cents} liquidado={t.receber.liquidado_cents} saldo={t.receber.saldo_cents} />
            ) : null}
            {filtros.natureza !== "receber" ? (
              <Total rotulo="A pagar" qtd={t.pagar.qtd} valor={t.pagar.valor_cents} liquidado={t.pagar.liquidado_cents} saldo={t.pagar.saldo_cents} />
            ) : null}
            {t.asaas_a_vincular.qtd > 0 ? (
              <button
                type="button"
                onClick={() => onFiltro({ origem: "asaas", natureza: "receber" })}
                className="rounded-[12px] border border-asaas/40 bg-asaas/10 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-asaas focus-visible:outline-none"
              >
                <p className="ledger-eyebrow">Asaas no período</p>
                <p className="mt-1 font-display text-xl font-bold tabular-nums text-ledger-text">
                  {formatBRLFromCents(t.asaas_a_vincular.aberto_cents)} em aberto
                </p>
                <p className="text-xs font-medium text-ledger-muted">
                  {formatInt(t.asaas_a_vincular.aberto_qtd)} cobrança(s) · {formatInt(t.asaas_a_vincular.clientes_aberto)} cliente(s) · já somadas em "A receber"
                </p>
                {t.asaas_a_vincular.recebido_qtd > 0 ? (
                  <p className="text-xs font-medium text-ledger-text tabular-nums">
                    Recebido no Asaas {formatBRLFromCents(t.asaas_a_vincular.recebido_cents)} ({formatInt(t.asaas_a_vincular.recebido_qtd)}) · fora do total até conferir
                  </p>
                ) : null}
              </button>
            ) : null}
          </div>
          <p className="px-5 pt-2 text-xs text-ledger-muted">
            {d.criterio} Período {dataBR(d.periodo.de)} a {dataBR(d.periodo.ate)} · saldo na data {dataBR(d.periodo.corte)}.
          </p>

          {/* celular: cartões */}
          <ul className="mt-3 space-y-2 px-3 md:hidden">
            {d.rows.map((r) => (
              <LinhaCartao key={`${r.tipo}-${r.id}`} r={r} onAbrir={abrir} podeBaixar={podeBaixar} />
            ))}
          </ul>

          {/* computador: tabela */}
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-line-soft bg-cream-2 text-left text-xs text-ledger-muted">
                  <th className="px-5 py-2">Vencimento</th>
                  <th className="px-3 py-2">Descrição / pessoa</th>
                  <th className="px-3 py-2">Parcela</th>
                  <th className="px-3 py-2">Competência</th>
                  <th className="px-3 py-2 text-right">Bruto</th>
                  <th className="px-3 py-2 text-right">Ajustes</th>
                  <th className="px-3 py-2 text-right">Recebido/pago</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-5 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr
                    key={`${r.tipo}-${r.id}`}
                    className="cursor-pointer border-b border-line-soft/60 align-top transition hover:bg-cream-2/70"
                    onClick={() => abrir(r)}
                  >
                    <td className="px-5 py-2 tabular-nums">{dataBR(r.vencimento)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <EtiquetaOrigem origem={r.origem} />
                        <span className={`text-[0.65rem] font-bold uppercase ${r.direction === "payable" ? "text-destructive" : "text-emerald-700"}`}>
                          {r.direction === "payable" ? "Pagar" : "Receber"}
                        </span>
                        <span className="font-medium text-ledger-text">{r.descricao}</span>
                      </div>
                      <p className="text-xs text-ledger-muted">
                        {r.pessoa ?? "Pessoa não identificada"}
                        {r.conta_liquidacao ? ` · liquidou em ${r.conta_liquidacao}` : r.conta_prevista ? ` · prevista ${r.conta_prevista}` : ""}
                        {r.external_id ? ` · ${r.external_id}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.numero ? `${r.numero}/${r.total_parcelas}` : "—"}</td>
                    <td className="px-3 py-2">{mesBR(r.competencia)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRLFromCents(r.valor_cents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.ajustes_cents ? formatBRLFromCents(r.ajustes_cents) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRLFromCents(r.liquidado_cents)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatBRLFromCents(r.saldo_cents)}</td>
                    <td className="px-3 py-2">
                      {ROTULO_SIT[r.situacao]}
                      {r.status_externo ? <span className="block text-xs text-ledger-muted">Asaas: {r.status_externo === "PENDING" ? "pendente" : r.status_externo === "RECEIVED" ? "recebida" : r.status_externo === "CONFIRMED" ? "confirmada" : r.status_externo === "OVERDUE" ? "vencida" : r.status_externo === "RECEIVED_IN_CASH" ? "recebida em dinheiro" : r.status_externo}</span> : null}
                      {r.invoice_url ? (
                        <a href={r.invoice_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block text-xs text-asaas underline">
                          Ver fatura
                        </a>
                      ) : null}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        <AcaoLinha r={r} podeBaixar={podeBaixar} onAbrir={abrir} />
                        {r.tipo === "parcela" && r.direction === "receivable" && r.saldo_cents > 0 && !r.invoice_url ? (
                          <CobrarParcelaAsaas installmentId={r.id} saldoCents={r.saldo_cents} vencimento={r.vencimento} nome={r.pessoa} compacto />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.rows.length === 0 ? <p className="px-5 py-8 text-center text-ledger-muted">Sem dados para estes filtros.</p> : null}
          <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="text-ledger-muted">{formatInt(t.linhas)} linha(s)</span>
            <div className="flex items-center gap-2">
              <button type="button" className="admin-btn min-h-11" disabled={pagina <= 1} onClick={() => onFiltro({ pagina: pagina - 1 }, false)}>
                Anterior
              </button>
              <span>
                {pagina} de {paginas}
              </span>
              <button type="button" className="admin-btn min-h-11" disabled={pagina >= paginas} onClick={() => onFiltro({ pagina: pagina + 1 }, false)}>
                Próxima
              </button>
            </div>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function AcaoLinha({ r, podeBaixar, onAbrir }: { r: LinhaPR; podeBaixar: boolean; onAbrir: (r: LinhaPR, baixa?: boolean) => void }) {
  if (r.tipo === "parcela" && r.saldo_cents > 0 && podeBaixar) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAbrir(r, true);
        }}
        className="inline-flex min-h-10 items-center rounded-[10px] bg-ledger-text px-3 text-xs font-semibold whitespace-nowrap text-surface"
      >
        {r.direction === "payable" ? "Dar baixa (pago)" : "Dar baixa (recebido)"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(r);
      }}
      className="admin-btn min-h-10 text-xs whitespace-nowrap"
    >
      Abrir ficha
    </button>
  );
}

function LinhaCartao({ r, onAbrir, podeBaixar }: { r: LinhaPR; onAbrir: (r: LinhaPR, baixa?: boolean) => void; podeBaixar: boolean }) {
  return (
    <li className="rounded-[12px] border border-line-soft bg-surface p-3">
      <details>
        <summary className="flex min-h-12 cursor-pointer list-none items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <EtiquetaOrigem origem={r.origem} />
              <span className="text-xs text-ledger-muted">{dataBR(r.vencimento)}</span>
            </div>
            <p className="mt-1 truncate font-medium text-ledger-text">{r.descricao}</p>
            <p className="truncate text-xs text-ledger-muted">{r.pessoa ?? "Pessoa não identificada"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-semibold tabular-nums">{formatBRLFromCents(r.saldo_cents)}</p>
            <p className="text-xs text-ledger-muted">{ROTULO_SIT[r.situacao]}</p>
          </div>
        </summary>
        <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
          <dt className="text-ledger-muted">Bruto</dt>
          <dd className="text-right tabular-nums">{formatBRLFromCents(r.valor_cents)}</dd>
          <dt className="text-ledger-muted">Recebido/pago</dt>
          <dd className="text-right tabular-nums">{formatBRLFromCents(r.liquidado_cents)}</dd>
          <dt className="text-ledger-muted">Competência</dt>
          <dd className="text-right">{mesBR(r.competencia)}</dd>
          {r.numero ? (
            <>
              <dt className="text-ledger-muted">Parcela</dt>
              <dd className="text-right">
                {r.numero}/{r.total_parcelas}
              </dd>
            </>
          ) : null}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <AcaoLinha r={r} podeBaixar={podeBaixar} onAbrir={onAbrir} />
          {r.tipo === "parcela" && r.saldo_cents > 0 && podeBaixar ? (
            <button type="button" className="admin-btn min-h-10 text-xs" onClick={() => onAbrir(r)}>
              Abrir ficha
            </button>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function Total({ rotulo, qtd, valor, liquidado, saldo }: { rotulo: string; qtd: number; valor: number; liquidado: number; saldo: number }) {
  return (
    <div className="rounded-[12px] border border-line-soft bg-cream-2 px-4 py-3">
      <p className="ledger-eyebrow">
        {rotulo} · {formatInt(qtd)} parcela(s)
      </p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-ledger-text">{formatBRLFromCents(saldo)}</p>
      <p className="text-xs font-medium text-ledger-muted tabular-nums">
        saldo · bruto {formatBRLFromCents(valor)} · liquidado {formatBRLFromCents(liquidado)}
      </p>
    </div>
  );
}

function ListaLiquidacoes({
  direction,
  de,
  ate,
  pagina,
  onPagina,
}: {
  direction: "receivable" | "payable";
  de: string;
  ate: string;
  pagina: number;
  onPagina: (p: number) => void;
}) {
  const q = useQuery({
    queryKey: ["fin-liquidacoes", direction, de, ate, pagina],
    queryFn: () => fetchLiquidacoes({ direction, de, ate, limit: POR, offset: (pagina - 1) * POR }),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const paginas = d ? Math.max(1, Math.ceil(d.total / POR)) : 1;
  return (
    <Panel title={direction === "payable" ? "Pagamentos no período" : "Recebimentos no período"} flush>
      {q.isLoading ? <Skeleton className="m-5 h-40" /> : null}
      {q.error ? <ErrorState message={`Não foi possível carregar: ${(q.error as Error).message}`} /> : null}
      {d ? (
        <>
          <p className="px-5 pt-3 text-sm">
            {formatInt(d.total)} liquidação(ões) · soma <strong className="tabular-nums">{formatBRLFromCents(d.soma_cents)}</strong>
          </p>
          <p className="px-5 pt-1 text-xs text-ledger-muted">{d.criterio}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line-soft bg-cream-2 text-left text-xs text-ledger-muted">
                  <th className="px-5 py-2">Data</th>
                  <th className="px-3 py-2">Descrição / pessoa</th>
                  <th className="px-3 py-2">Conta</th>
                  <th className="px-5 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft/60">
                    <td className="px-5 py-2 tabular-nums">{dataBR(r.data)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.descricao ?? r.referencia ?? "—"}</p>
                      <p className="text-xs text-ledger-muted">{r.pessoa ?? ""}{r.is_reversal ? " · estorno" : ""}</p>
                    </td>
                    <td className="px-3 py-2">{r.conta ?? "—"}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{formatBRLFromCents(r.valor_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.rows.length === 0 ? <p className="px-5 py-8 text-center text-ledger-muted">Sem dados no período.</p> : null}
          <div className="flex items-center justify-end gap-2 px-5 py-3 text-sm">
            <button type="button" className="admin-btn min-h-11" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}>
              Anterior
            </button>
            <span>
              {pagina} de {paginas}
            </span>
            <button type="button" className="admin-btn min-h-11" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>
              Próxima
            </button>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function PainelAsaas({ de, ate }: { de: string; ate: string }) {
  const qc = useQueryClient();
  useSincronizacaoDiariaAsaas(de, ate);
  const sync = useServerFn(sincronizarCobrancasAsaas);
  const ultima = useQuery({ queryKey: ["asaas-sync-ultima"], queryFn: fetchUltimaSyncAsaas });
  const m = useMutation({
    mutationFn: () => sync({ data: { de, ate } }),
    onSuccess: (r) => {
      toast.success(`Asaas: ${r.recebidas} lidas, ${r.inseridas} novas · ${r.vinculadas} conciliadas automaticamente · ${r.baixas} baixa(s)${r.ambiguas ? ` · ${r.ambiguas} para conferir` : ""}.`);
      void qc.invalidateQueries({ queryKey: ["fin-pagar-receber"] });
      void qc.invalidateQueries({ queryKey: ["fin-overview"] });
      void qc.invalidateQueries({ queryKey: ["asaas-sync-ultima"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const u = ultima.data;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-asaas/40 bg-asaas/10 px-5 py-4">
      <div className="text-sm">
        <p className="font-semibold text-ledger-text">Cobranças do Asaas (produção)</p>
        <p className="text-xs text-ledger-muted">
          {ultima.error
            ? "Não foi possível ler a última sincronização."
            : u
              ? `Última sincronização: ${new Date(u.iniciado_em).toLocaleString("pt-BR")} · ${u.status === "concluida" ? `${u.recebidas} cobranças lidas (todas as datas)` : u.status === "falhou" ? `falhou: ${u.erro ?? ""}` : "em andamento"}`
              : "Nenhuma sincronização ainda."}
        </p>
        <p className="text-xs text-ledger-muted">Não cria cobrança nem avisa cliente. Liga sozinha a cobrança ao título quando CPF, valor e vencimento batem de forma única, e dá baixa nas pagas.</p>
      </div>
      <button
        type="button"
        disabled={m.isPending}
        onClick={() => m.mutate()}
        className="inline-flex min-h-11 items-center rounded-[10px] bg-asaas px-4 text-sm font-semibold text-asaas-foreground disabled:opacity-60"
      >
        {m.isPending ? "Sincronizando…" : "Sincronizar todas as cobranças do Asaas"}
      </button>
    </div>
  );
}

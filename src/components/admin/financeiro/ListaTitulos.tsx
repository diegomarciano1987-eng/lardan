import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { StatusBadge, formatBRLFromCents } from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { NovoTituloDialog } from "@/components/admin/financeiro/NovoTituloDialog";
import { TituloSheet } from "@/components/admin/financeiro/TituloSheet";
import { useCapabilities } from "@/lib/capabilities";
import { usePeriodoFinanceiro } from "@/components/admin/financeiro/PeriodoGlobal";
import {
  listFinTitles,
  TITLE_STATUS_LABEL,
  type FinDirection,
  type FinTitleRow,
} from "@/lib/financeiro";

const PAGE_SIZE = 20;

export const dataBR = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "—";

function useDebounce<T>(valor: T, ms = 350) {
  const [saida, setSaida] = React.useState(valor);
  React.useEffect(() => {
    const t = setTimeout(() => setSaida(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return saida;
}

/** Lista de títulos a pagar ou a receber, com filtros preservados na URL. */
export function ListaTitulos({
  direction,
  situacaoInicial = "todos",
  buscaInicial = "",
  onFiltrosChange,
}: {
  direction: FinDirection;
  situacaoInicial?: string;
  buscaInicial?: string;
  onFiltrosChange?: (f: { busca: string; situacao: string }) => void;
}) {
  const caps = useCapabilities();
  const podeCriar = caps.includes(
    direction === "payable" ? "finance.payable.manage" : "finance.receivable.manage",
  );
  const [busca, setBusca] = React.useState(buscaInicial);
  const buscaLenta = useDebounce(busca);
  const [pagina, setPagina] = React.useState(0);
  const [situacao, setSituacao] = React.useState(situacaoInicial);
  const [classificacao, setClassificacao] = React.useState("todos");
  const [novo, setNovo] = React.useState(false);
  const [aberto, setAberto] = React.useState<string | null>(null);

  const periodo = usePeriodoFinanceiro();
  // Chegando com uma busca (ex.: pela busca global), procura em todo o período.
  const [todoPeriodo, setTodoPeriodo] = React.useState(Boolean(buscaInicial));
  const de = todoPeriodo ? undefined : periodo.de;
  const ate = todoPeriodo ? undefined : periodo.ate;

  React.useEffect(() => setPagina(0), [buscaLenta, situacao, classificacao, de, ate]);
  React.useEffect(() => {
    onFiltrosChange?.({ busca: buscaLenta, situacao });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaLenta, situacao]);

  const q = useQuery({
    queryKey: ["fin-titles", direction, buscaLenta, situacao, classificacao, pagina, de, ate],
    queryFn: () =>
      listFinTitles({
        direction,
        search: buscaLenta,
        situacao,
        limit: PAGE_SIZE,
        offset: pagina * PAGE_SIZE,
        ...(de ? { de } : {}),
        ...(ate ? { ate } : {}),
        ...(classificacao === "pendentes" ? { semClassificacao: true } : {}),
      }),
  });

  const hojeIso = new Date().toLocaleDateString("sv-SE");
  const resumo = q.data?.resumo;

  const colunas: Column<FinTitleRow>[] = [
    {
      key: "descricao",
      header: "Título",
      render: (r) => (
        <div className="min-w-0">
          {r.numero ? (
            <p className="text-[0.7rem] font-semibold tracking-[0.08em] text-bronze tabular-nums">
              Nº {r.numero}
            </p>
          ) : null}
          <p className="truncate font-semibold text-ledger-text">{r.descricao}</p>
          <p className="truncate text-xs text-ledger-muted">
            {r.contraparte}
            {r.documento ? ` · doc. ${r.documento}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "vencimento",
      header: "Vencimento",
      render: (r) => {
        const venc = r.vencimento_ref ?? r.proximo_vencimento;
        const atrasado = !r.quitado && r.status !== "cancelado" && !!r.proximo_vencimento && r.proximo_vencimento < hojeIso;
        return (
          <span className={atrasado ? "tabular-nums font-semibold text-danger" : "tabular-nums"}>
            {dataBR(venc ?? null)}
          </span>
        );
      },
    },
    {
      key: "parcelas",
      header: "Parcelas",
      render: (r) => <span className="tabular-nums">{r.parcelas}</span>,
    },
    {
      key: "valor",
      header: "Valor",
      render: (r) => (
        <span className="tabular-nums">
          {formatBRLFromCents(r.pago_cents)} / {formatBRLFromCents(r.valor_cents)}
        </span>
      ),
    },
    {
      key: "classificacao",
      header: "Classificação",
      render: (r) =>
        r.pendente_classificacao ? (
          <StatusBadge tone="warning">Pendente de classificação</StatusBadge>
        ) : (
          <div className="min-w-0 text-xs">
            <p className="truncate text-ledger-text">{r.plano_label ?? "—"}</p>
            <p className="truncate text-ledger-muted">{r.centro_label ?? "—"}</p>
          </div>
        ),
    },
    {
      key: "quitado",
      header: "Quitado",
      render: (r) =>
        r.status === "cancelado" ? (
          <StatusBadge tone="danger">Cancelado</StatusBadge>
        ) : r.quitado ? (
          <div className="text-xs">
            <StatusBadge tone="success">Quitado</StatusBadge>
            {r.ultimo_pagamento ? (
              <p className="mt-1 tabular-nums text-ledger-muted">em {dataBR(r.ultimo_pagamento)}</p>
            ) : null}
          </div>
        ) : r.proximo_vencimento && r.proximo_vencimento < hojeIso ? (
          <StatusBadge tone="danger">Vencido</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Em aberto</StatusBadge>
        ),
    },
    {
      key: "status",
      header: "Aprovação",
      render: (r) => (
        <span className="text-xs text-ledger-muted">{TITLE_STATUS_LABEL[r.status]}</span>
      ),
    },
  ];

  const chip = (valor: string, rotulo: string, qtd: number | undefined, cents: number | undefined, tom: string) => (
    <button
      type="button"
      onClick={() => setSituacao(situacao === valor ? "todos" : valor)}
      className={`flex min-h-12 items-center gap-3 rounded-[10px] border px-4 py-2 text-left transition ${
        situacao === valor ? "border-bronze bg-cream-2" : "border-line-soft bg-surface hover:border-bronze"
      }`}
    >
      <span className={`size-2.5 rounded-full ${tom}`} aria-hidden />
      <span>
        <span className="block text-xs font-semibold text-ledger-muted">
          {rotulo} {todoPeriodo ? "(todo o período)" : "no período"}
        </span>
        <span className="block text-sm font-semibold tabular-nums text-ledger-text">
          {qtd ?? "—"} · {cents === undefined ? "—" : formatBRLFromCents(cents)}
        </span>
      </span>
    </button>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {chip("liquidado", "Quitadas", resumo?.quitados, resumo?.quitado_cents, "bg-success")}
        {chip("aberto", direction === "payable" ? "Em aberto (a pagar)" : "Em aberto (a receber)", resumo?.abertos, resumo?.aberto_cents, "bg-warning")}
      </div>
      <DataTable
        columns={colunas}
        rows={q.data?.rows ?? []}
        rowKey={(r) => r.id}
        total={q.data?.total ?? 0}
        page={pagina}
        pageSize={PAGE_SIZE}
        onPageChange={setPagina}
        search={busca}
        onSearchChange={setBusca}
        searchPlaceholder="Buscar por descrição, documento ou contraparte"
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => setAberto(r.id)}
        rowClassName={(r) =>
          r.status === "cancelado"
            ? "opacity-60"
            : r.quitado
              ? "bg-success/[0.06] hover:bg-success/[0.1]"
              : r.proximo_vencimento && r.proximo_vencimento < hojeIso
                ? "bg-danger/[0.05] hover:bg-danger/[0.09]"
                : undefined
        }
        emptyTitle="Nenhum título registrado"
        emptyDescription={
          direction === "payable"
            ? "Cadastre a primeira conta a pagar para começar."
            : "Cadastre a primeira conta a receber para começar."
        }
        filters={
          <>
            <SmartSelect
              options={[
                { value: "periodo", label: "Período selecionado" },
                { value: "tudo", label: "Todo o período" },
              ]}
              value={todoPeriodo ? "tudo" : "periodo"}
              onChange={(v) => setTodoPeriodo(v === "tudo")}
              className="w-52"
            />
            <SmartSelect
              options={[
                { value: "todos", label: "Todas as situações" },
                { value: "aberto", label: "Em aberto" },
                { value: "vencido", label: "Vencidas" },
                { value: "liquidado", label: "Quitadas" },
              ]}
              value={situacao}
              onChange={setSituacao}
              className="w-52"
            />
            <SmartSelect
              options={[
                { value: "todos", label: "Toda a classificação" },
                { value: "pendentes", label: "Pendentes de classificação" },
              ]}
              value={classificacao}
              onChange={setClassificacao}
              className="w-64"
            />
          </>
        }
        actions={
          podeCriar ? (
            <button type="button" className="admin-btn-primary" onClick={() => setNovo(true)}>
              <Plus aria-hidden className="size-4" />
              {direction === "payable" ? "Nova conta a pagar" : "Nova conta a receber"}
            </button>
          ) : undefined
        }
      />
      <NovoTituloDialog open={novo} onOpenChange={setNovo} direction={direction} />
      <TituloSheet id={aberto} onOpenChange={(v) => !v && setAberto(null)} />
    </>
  );
}

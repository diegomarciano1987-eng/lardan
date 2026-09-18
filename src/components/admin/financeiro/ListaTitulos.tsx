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

  const { de, ate } = usePeriodoFinanceiro();

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
        de,
        ate,
        ...(classificacao === "pendentes" ? { semClassificacao: true } : {}),
      }),
  });

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
      header: "Próximo vencimento",
      render: (r) => <span className="tabular-nums">{dataBR(r.proximo_vencimento)}</span>,
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
      key: "status",
      header: "Situação",
      render: (r) => (
        <StatusBadge
          tone={
            r.status === "cancelado"
              ? "danger"
              : r.status === "submetido"
                ? "warning"
                : r.status === "rascunho"
                  ? "neutral"
                  : "success"
          }
        >
          {TITLE_STATUS_LABEL[r.status]}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
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
                { value: "todos", label: "Todas as situações" },
                { value: "aberto", label: "Em aberto" },
                { value: "vencido", label: "Vencidas" },
                { value: "liquidado", label: "Liquidadas" },
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

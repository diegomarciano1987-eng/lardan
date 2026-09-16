import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
  formatBRLFromCents,
} from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { NovoTituloDialog } from "@/components/admin/financeiro/NovoTituloDialog";
import { TituloSheet } from "@/components/admin/financeiro/TituloSheet";
import { ContasCaixas } from "@/components/admin/financeiro/ContasCaixas";
import { Conciliacao } from "@/components/admin/financeiro/Conciliacao";
import { useCapabilities } from "@/lib/capabilities";
import {
  fetchFinOverview,
  listFinTitles,
  TITLE_STATUS_LABEL,
  type FinDirection,
  type FinTitleRow,
} from "@/lib/financeiro";

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  component: FinanceiroPage,
  head: () => ({
    meta: [
      { title: "Financeiro — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const PAGE_SIZE = 20;

const dataBR = (d: string | null) =>
  d ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${d}T12:00:00`)) : "—";

function useDebounce<T>(valor: T, ms = 350) {
  const [saida, setSaida] = React.useState(valor);
  React.useEffect(() => {
    const t = setTimeout(() => setSaida(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return saida;
}

function Kpi({ rotulo, cents, nota }: { rotulo: string; cents: number | undefined; nota?: string }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-[1.75rem] font-bold text-ledger-text tabular-nums">
        {cents === undefined ? "—" : formatBRLFromCents(cents)}
      </p>
      {nota && <p className="mt-1 text-xs font-medium text-ledger-muted">{nota}</p>}
    </div>
  );
}

function VisaoGeral() {
  const q = useQuery({ queryKey: ["fin-overview"], queryFn: fetchFinOverview });
  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <ErrorState message="Não foi possível carregar o painel financeiro." />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Saldo em contas" cents={d?.saldo_contas_cents} nota="Calculado pelo razão" />
        <Kpi rotulo="A receber em aberto" cents={d?.a_receber_cents} />
        <Kpi rotulo="A pagar em aberto" cents={d?.a_pagar_cents} />
        <Kpi
          rotulo="Vencido"
          cents={(d?.vencido_receber_cents ?? 0) + (d?.vencido_pagar_cents ?? 0)}
          nota="Receber e pagar somados"
        />
      </div>
      <Panel title="Projeção de vencimentos">
        <div className="grid gap-4 sm:grid-cols-3">
          {[30, 60, 90].map((dias) => {
            const receber = d?.[`proj${dias}_receber_cents` as keyof typeof d] as number | undefined;
            const pagar = d?.[`proj${dias}_pagar_cents` as keyof typeof d] as number | undefined;
            return (
              <div key={dias} className="rounded-[12px] border border-line-soft bg-cream-2 p-4">
                <p className="ledger-eyebrow">Próximos {dias} dias</p>
                <p className="mt-2 text-sm font-semibold text-ledger-text tabular-nums">
                  Entradas previstas {formatBRLFromCents(receber ?? 0)}
                </p>
                <p className="text-sm font-semibold text-ledger-text tabular-nums">
                  Saídas previstas {formatBRLFromCents(pagar ?? 0)}
                </p>
                <p className="mt-1 text-xs font-medium text-ledger-muted">
                  Resultado previsto {formatBRLFromCents((receber ?? 0) - (pagar ?? 0))}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="No período atual">
        <div className="grid gap-4 sm:grid-cols-2">
          <Kpi rotulo="Recebido" cents={d?.recebido_periodo_cents} />
          <Kpi rotulo="Pago" cents={d?.pago_periodo_cents} />
        </div>
      </Panel>
    </div>
  );
}

function ListaTitulos({ direction }: { direction: FinDirection }) {
  const caps = useCapabilities();
  const podeCriar = caps.includes(
    direction === "payable" ? "finance.payable.manage" : "finance.receivable.manage",
  );
  const [busca, setBusca] = React.useState("");
  const buscaLenta = useDebounce(busca);
  const [pagina, setPagina] = React.useState(0);
  const [situacao, setSituacao] = React.useState("todos");
  const [novo, setNovo] = React.useState(false);
  const [aberto, setAberto] = React.useState<string | null>(null);

  React.useEffect(() => setPagina(0), [buscaLenta, situacao]);

  const q = useQuery({
    queryKey: ["fin-titles", direction, buscaLenta, situacao, pagina],
    queryFn: () =>
      listFinTitles({
        direction,
        search: buscaLenta,
        situacao,
        limit: PAGE_SIZE,
        offset: pagina * PAGE_SIZE,
      }),
  });

  const colunas: Column<FinTitleRow>[] = [
    {
      key: "descricao",
      header: "Título",
      render: (r) => (
        <div className="min-w-0">
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
      key: "status",
      header: "Situação",
      render: (r) => (
        <StatusBadge tone={r.status === "cancelado" ? "danger" : "success"}>
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
        }
        actions={
          podeCriar ? (
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => setNovo(true)}>
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

const ABAS = [
  { id: "visao", label: "Visão geral" },
  { id: "pagar", label: "Contas a pagar" },
  { id: "receber", label: "Contas a receber" },
  { id: "contas", label: "Contas e caixas" },
  { id: "conciliacao", label: "Conciliação" },
] as const;

function FinanceiroPage() {
  const caps = useCapabilities();
  const [aba, setAba] = React.useState<(typeof ABAS)[number]["id"]>("visao");

  if (!caps.includes("finance.dashboard.view")) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Lardan Cloud" title="Financeiro" />
        <Panel>
          <EmptyState
            title="Acesso não liberado"
            description="Seu perfil não tem permissão para ver dados financeiros."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Lardan Cloud"
        title="Financeiro"
        description="Títulos, parcelas, baixas e contas — tudo gravado no servidor, com histórico que não se apaga."
      />

      <nav className="flex flex-wrap gap-2" aria-label="Áreas do Financeiro">
        {ABAS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setAba(a.id)}
            aria-current={aba === a.id ? "page" : undefined}
            className={
              aba === a.id
                ? "rounded-[10px] border border-bronze bg-surface px-4 py-2 text-sm font-semibold text-bronze shadow-sm"
                : "rounded-[10px] border border-line-soft bg-cream-2 px-4 py-2 text-sm font-semibold text-ledger-muted transition hover:border-line"
            }
          >
            {a.label}
          </button>
        ))}
      </nav>

      {aba === "visao" && <VisaoGeral />}
      {aba === "pagar" && <ListaTitulos direction="payable" />}
      {aba === "receber" && <ListaTitulos direction="receivable" />}
      {aba === "contas" && <ContasCaixas />}
      {aba === "conciliacao" && <Conciliacao />}

      <Panel title="Ainda em construção">
        <ul className="list-disc space-y-1 pl-5 text-sm font-medium text-ledger-muted">
          <li>Conciliação por arquivo CNAB (CSV e OFX já disponíveis).</li>
          <li>Importação de contas a pagar e a receber.</li>
          <li>DRE gerencial e relatórios exportáveis.</li>
          <li>Módulo de Cobranças com régua e negociações.</li>
          <li>Integração de cobrança externa — não configurada e sem nenhuma chamada externa.</li>
        </ul>
      </Panel>
    </div>
  );
}

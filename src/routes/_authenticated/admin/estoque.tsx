import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, FileUp, PackagePlus } from "lucide-react";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  formatBRLFromCents,
  formatDateTime,
  formatInt,
} from "@/components/admin/ui";
import { DataTable, type Column } from "@/components/admin/DataTable";
import { SmartSelect } from "@/components/premium/SmartSelect";
import { StockMovementDialog } from "@/components/admin/StockMovementDialog";
import { StockItemPanel } from "@/components/admin/StockItemPanel";
import { StockThumb } from "@/components/admin/StockThumb";
import { ImportProductsDialog } from "@/components/admin/ImportProductsDialog";
import { useCapabilities } from "@/lib/capabilities";
import {
  MOVE_LABEL,
  fetchStockOverview,
  listBalances,
  listMovements,
  listStockLocations,
  signedMediaMap,
  type BalanceRow,
  type MovementRow,
} from "@/lib/stock";

export const Route = createFileRoute("/_authenticated/admin/estoque")({
  component: EstoquePage,
  head: () => ({
    meta: [
      { title: "Estoque — Administração LARDAN" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const PAGE_SIZE = 20;

/** Atraso curto na digitação: a consulta anterior é cancelada pelo React Query. */
function useDebounce<T>(valor: T, ms = 350) {
  const [saida, setSaida] = React.useState(valor);
  React.useEffect(() => {
    const t = setTimeout(() => setSaida(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return saida;
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: number | undefined }) {
  return (
    <div className="ledger-panel px-5 py-4">
      <p className="ledger-eyebrow">{rotulo}</p>
      <p className="mt-1 font-display text-3xl font-bold text-ledger-text tabular-nums">
        {valor === undefined ? "—" : formatInt(valor)}
      </p>
    </div>
  );
}

function EstoquePage() {
  const caps = useCapabilities();
  const podeOperar = caps.includes("stock.operate");

  const [aba, setAba] = React.useState<"saldos" | "movimentos">("saldos");
  const [dialogo, setDialogo] = React.useState(false);
  const [importacao, setImportacao] = React.useState(false);
  const [itemAberto, setItemAberto] = React.useState<string | null>(null);

  const [buscaSaldo, setBuscaSaldo] = React.useState("");
  const [paginaSaldo, setPaginaSaldo] = React.useState(0);
  const [local, setLocal] = React.useState("todos");

  const [buscaMov, setBuscaMov] = React.useState("");
  const [paginaMov, setPaginaMov] = React.useState(0);
  const [tipo, setTipo] = React.useState("todos");

  const termoSaldo = useDebounce(buscaSaldo);
  const termoMov = useDebounce(buscaMov);

  const resumo = useQuery({ queryKey: ["stock", "overview"], queryFn: fetchStockOverview });
  const locais = useQuery({ queryKey: ["stock-locations"], queryFn: listStockLocations });

  const saldos = useQuery({
    queryKey: ["stock", "balances", termoSaldo, paginaSaldo, local],
    queryFn: ({ signal }) =>
      listBalances({
        search: termoSaldo,
        page: paginaSaldo,
        pageSize: PAGE_SIZE,
        locationId: local === "todos" ? undefined : local,
        signal,
      }),
    enabled: aba === "saldos",
    placeholderData: (anterior) => anterior,
  });

  const movimentos = useQuery({
    queryKey: ["stock", "movements", termoMov, paginaMov, tipo],
    queryFn: ({ signal }) =>
      listMovements({
        search: termoMov,
        page: paginaMov,
        pageSize: PAGE_SIZE,
        kind: tipo,
        signal,
      }),
    enabled: aba === "movimentos",
    placeholderData: (anterior) => anterior,
  });

  /** Uma única chamada assinada por página exibida. */
  const caminhosSaldo = (saldos.data?.rows ?? []).map((r) => r.media_path);
  const fotosSaldo = useQuery({
    queryKey: ["stock", "fotos-saldos", caminhosSaldo.join(",")],
    queryFn: () => signedMediaMap(caminhosSaldo),
    enabled: caminhosSaldo.filter(Boolean).length > 0,
  });

  const caminhosMov = (movimentos.data?.rows ?? []).map((r) => r.media_path);
  const fotosMov = useQuery({
    queryKey: ["stock", "fotos-movs", caminhosMov.join(",")],
    queryFn: () => signedMediaMap(caminhosMov),
    enabled: caminhosMov.filter(Boolean).length > 0,
  });

  const reservasAtivas = saldos.data?.reservasAtivas ?? false;

  const colunasSaldo: Column<BalanceRow>[] = [
    {
      key: "foto",
      header: "Foto",
      render: (r) => (
        <StockThumb
          url={r.media_path ? fotosSaldo.data?.[r.media_path] : null}
          alt={r.produto}
        />
      ),
    },
    {
      key: "peca",
      header: "Peça",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ledger-text">{r.produto}</p>
          <p className="truncate text-xs text-ledger-muted">
            {r.variante}
            {r.sku ? ` · ${r.sku}` : ""}
            {r.barcode ? ` · ${r.barcode}` : ""}
          </p>
        </div>
      ),
    },
    { key: "local", header: "Local", render: (r) => r.local_nome },
    {
      key: "qtd",
      header: "Saldo físico",
      className: "text-right tabular-nums",
      render: (r) =>
        r.quantity < 0 ? (
          <StatusBadge tone="danger">{formatInt(r.quantity)}</StatusBadge>
        ) : (
          formatInt(r.quantity)
        ),
    },
    {
      key: "reservado",
      header: reservasAtivas ? "Reservado" : "Reservado (em implantação)",
      className: "text-right tabular-nums",
      render: (r) =>
        reservasAtivas ? (
          formatInt(r.reserved)
        ) : (
          <span className="text-xs text-ledger-muted">—</span>
        ),
    },
    {
      key: "atualizado",
      header: "Atualizado",
      render: (r) => (
        <span className="text-xs text-ledger-muted">{formatDateTime(r.updated_at)}</span>
      ),
    },
  ];

  const colunasMov: Column<MovementRow>[] = [
    {
      key: "quando",
      header: "Quando",
      render: (r) => (
        <span className="text-xs text-ledger-muted">{formatDateTime(r.created_at)}</span>
      ),
    },
    { key: "tipo", header: "Tipo", render: (r) => MOVE_LABEL[r.kind] },
    {
      key: "peca",
      header: "Peça",
      render: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <StockThumb
            url={r.media_path ? fotosMov.data?.[r.media_path] : null}
            alt={r.produto ?? "Peça"}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-ledger-text">{r.produto ?? "—"}</p>
            <p className="truncate text-xs text-ledger-muted">
              {r.variante}
              {r.sku ? ` · ${r.sku}` : ""}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "locais",
      header: "Origem → destino",
      render: (r) => (
        <span className="text-sm">
          {r.origem ?? "—"} → {r.destino ?? "—"}
        </span>
      ),
    },
    {
      key: "qtd",
      header: "Qtd.",
      className: "text-right tabular-nums",
      render: (r) => {
        const saida = r.kind === "saida" || (r.kind === "ajuste" && r.quantity < 0);
        const Icone = saida ? ArrowDownLeft : ArrowUpRight;
        return (
          <span
            className={
              saida
                ? "inline-flex items-center gap-1 font-semibold text-rose-700"
                : "inline-flex items-center gap-1 font-semibold text-emerald-700"
            }
          >
            <Icone aria-hidden className="size-3.5" />
            {saida ? "−" : "+"}
            {formatInt(Math.abs(r.quantity))}
          </span>
        );
      },
    },
    {
      key: "motivo",
      header: "Motivo",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{r.motivo ?? r.reason_code ?? "—"}</p>
          {r.reference && <p className="truncate text-xs text-ledger-muted">{r.reference}</p>}
        </div>
      ),
    },
    { key: "autor", header: "Autor", render: (r) => r.autor ?? "—" },
    // O custo só existe na tela quando o servidor autorizou (stock.cost.view).
    ...(movimentos.data?.podeVerCusto
      ? [
          {
            key: "custo",
            header: "Custo unit.",
            className: "text-right tabular-nums",
            render: (r: MovementRow) =>
              r.unit_cost_cents ? formatBRLFromCents(r.unit_cost_cents) : "—",
          },
        ]
      : []),
    {
      key: "saldo",
      header: "Saldo antes → depois",
      className: "text-right tabular-nums",
      render: (r) => {
        const partes: string[] = [];
        if (r.balance_from_after !== null && r.balance_from_after !== undefined)
          partes.push(
            `Origem: ${formatInt(r.balance_from_before ?? 0)} → ${formatInt(r.balance_from_after)}`,
          );
        if (r.balance_to_after !== null && r.balance_to_after !== undefined)
          partes.push(
            `Destino: ${formatInt(r.balance_to_before ?? 0)} → ${formatInt(r.balance_to_after)}`,
          );
        if (partes.length === 0)
          return r.balance_after === null ? "—" : formatInt(r.balance_after);
        return (
          <div className="text-xs leading-relaxed text-ledger-muted">
            {partes.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        );
      },
    },
  ];

  const semLocais = !locais.isLoading && (locais.data ?? []).length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="OPERAÇÃO · ESTOQUE"
        title="Estoque"
        description="Saldos por local e razão permanente de movimentações. Nenhum saldo é editado à mão."
        actions={
          podeOperar ? (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => setImportacao(true)} className="admin-btn-primary">
                <FileUp aria-hidden className="mr-2 inline size-4" />
                Importar planilha
              </button>
              <button type="button" onClick={() => setDialogo(true)} className="admin-btn-primary">
                <PackagePlus aria-hidden className="mr-2 inline size-4" />
                Nova movimentação
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Indicador rotulo="Locais ativos" valor={resumo.data?.locais} />
        <Indicador rotulo="Peças com saldo" valor={resumo.data?.pecas_com_saldo} />
        <Indicador rotulo="Unidades em estoque" valor={resumo.data?.unidades} />
        <Indicador rotulo="Saldos negativos" valor={resumo.data?.negativos} />
        <Indicador rotulo="Movimentos (7 dias)" valor={resumo.data?.movimentos_7d} />
      </div>

      {semLocais && (
        <Panel title="Antes de começar">
          <EmptyState
            title="Nenhum local ativo cadastrado"
            description="O estoque trabalha por local: depósito, loja, maleta ou trânsito. Cadastre pelo menos um local em Cadastros › Locais para poder registrar entradas e saídas."
          />
        </Panel>
      )}

      <div className="flex gap-2">
        {(["saldos", "movimentos"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAba(v)}
            className={
              aba === v
                ? "rounded-[10px] bg-ink px-4 py-2 text-sm font-semibold text-warm-ivory"
                : "rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ledger-muted hover:bg-surface-muted"
            }
          >
            {v === "saldos" ? "Saldos" : "Movimentações"}
          </button>
        ))}
      </div>

      {aba === "saldos" ? (
        <>
          {!reservasAtivas && (
            <p className="rounded-[10px] border border-line bg-surface-muted px-4 py-3 text-sm font-medium text-ledger-muted">
              Reservas em implantação: o sistema ainda não reserva peças. A coluna Reservado
              permanece vazia e o saldo disponível só passará a ser calculado (físico menos
              reservado) quando o motor de reservas estiver pronto.
            </p>
          )}
          <DataTable
            columns={colunasSaldo}
            rows={saldos.data?.rows ?? []}
            rowKey={(r) => r.id}
            total={saldos.data?.total ?? 0}
            page={paginaSaldo}
            pageSize={PAGE_SIZE}
            onPageChange={setPaginaSaldo}
            search={buscaSaldo}
            onSearchChange={(v) => {
              setBuscaSaldo(v);
              setPaginaSaldo(0);
            }}
            searchPlaceholder="Buscar por produto, variação, SKU, código legado ou código de barras…"
            onRowClick={(r) => setItemAberto(r.variant_id)}
            filters={
              <div className="w-56">
                <SmartSelect
                  options={[
                    { value: "todos", label: "Todos os locais" },
                    ...(locais.data ?? []).map((l) => ({ value: l.id, label: l.name, hint: l.code })),
                  ]}
                  value={local}
                  onChange={(v) => {
                    setLocal(v);
                    setPaginaSaldo(0);
                  }}
                />
              </div>
            }
            isLoading={saldos.isLoading}
            error={saldos.error}
            onRetry={() => void saldos.refetch()}
            emptyTitle="Sem saldo registrado"
            emptyDescription="Nenhuma peça possui saldo com os filtros atuais. Registre uma entrada para começar."
          />
        </>
      ) : (
        <DataTable
          columns={colunasMov}
          rows={movimentos.data?.rows ?? []}
          rowKey={(r) => r.id}
          total={movimentos.data?.total ?? 0}
          page={paginaMov}
          pageSize={PAGE_SIZE}
          onPageChange={setPaginaMov}
          search={buscaMov}
          onSearchChange={(v) => {
            setBuscaMov(v);
            setPaginaMov(0);
          }}
          searchPlaceholder="Buscar por produto, variação, SKU ou código de barras…"
          onRowClick={(r) => setItemAberto(r.variant_id)}
          filters={
            <div className="w-52">
              <SmartSelect
                options={[
                  { value: "todos", label: "Todos os tipos" },
                  ...(Object.keys(MOVE_LABEL) as (keyof typeof MOVE_LABEL)[]).map((k) => ({
                    value: k,
                    label: MOVE_LABEL[k],
                  })),
                ]}
                value={tipo}
                onChange={(v) => {
                  setTipo(v);
                  setPaginaMov(0);
                }}
              />
            </div>
          }
          isLoading={movimentos.isLoading}
          error={movimentos.error}
          onRetry={() => void movimentos.refetch()}
          emptyTitle="Sem movimentações"
          emptyDescription="Nenhuma movimentação registrada com os filtros atuais."
        />
      )}

      <StockItemPanel variantId={itemAberto} onClose={() => setItemAberto(null)} />
      <StockMovementDialog open={dialogo} onOpenChange={setDialogo} />
      <ImportProductsDialog open={importacao} onOpenChange={setImportacao} />
    </div>
  );
}

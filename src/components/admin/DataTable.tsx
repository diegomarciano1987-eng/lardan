import { type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Lista com busca, filtros e paginação — todos resolvidos no servidor. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  search,
  onSearchChange,
  searchPlaceholder = "Buscar…",
  filters,
  actions,
  isLoading,
  error,
  onRetry,
  onRowClick,
  emptyTitle = "Sem dados",
  emptyDescription = "Nenhum registro encontrado com os filtros atuais.",
}: Props<T>) {
  const primeiro = total === 0 ? 0 : page * pageSize + 1;
  const ultimo = Math.min(total, page * pageSize + rows.length);
  const ultimaPagina = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="ledger-panel flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3">
        <label className="relative flex-1 min-w-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ledger-muted" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-[10px] border border-line bg-surface pr-3 pl-9 text-sm text-ledger-text outline-none placeholder:text-ledger-muted focus:border-champagne"
          />
        </label>
        {filters}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>

      {error ? (
        <ErrorState
          message={error instanceof Error ? error.message : "Falha ao carregar os dados."}
          {...(onRetry ? { onRetry } : {})}
        />
      ) : isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-soft">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "px-4 py-2.5 text-left text-[0.6875rem] font-normal tracking-[0.12em] text-ledger-muted uppercase",
                      c.className,
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-line-soft last:border-0",
                    onRowClick && "cursor-pointer hover:bg-surface-muted",
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-4 py-3 text-ledger-text", c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3">
        <p className="num text-xs text-ledger-muted">
          {total === 0 ? "Sem registros" : `${primeiro}–${ultimo} de ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="admin-btn disabled:opacity-40"
            disabled={page <= 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" /> Anterior
          </button>
          <button
            type="button"
            className="admin-btn disabled:opacity-40"
            disabled={page >= ultimaPagina}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}

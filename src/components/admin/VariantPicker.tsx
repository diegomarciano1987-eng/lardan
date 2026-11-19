import * as React from "react";
import { FotoPeca } from "@/components/FotoPeca";
import { ChevronsUpDown, Search, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchVariants } from "@/lib/stock";
import { cn } from "@/lib/utils";

export interface VariantOption {
  id: string;
  label: string;
  sku: string | null;
  produto: string;
  /** 0340: referência da etiqueta (LAN...) — a equipe trabalha por ela. */
  referencia?: string | null;
}

/** Buscador de peças com consulta no servidor, debounce e resultado honesto. */
export function VariantPicker({
  value,
  onChange,
  placeholder = "Buscar peça por referência, nome, SKU ou código de barras…",
}: {
  value: VariantOption | null;
  onChange: (v: VariantOption | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [rows, setRows] = React.useState<VariantOption[]>([]);
  const [estado, setEstado] = React.useState<"idle" | "loading" | "error">("idle");

  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setEstado("loading");
    const t = setTimeout(async () => {
      try {
        const data = await searchVariants(term, 30);
        if (cancelado) return;
        setRows(
          data.map((v) => ({
            id: v.id,
            label: v.label,
            sku: v.sku,
            produto: v.products?.name ?? "—",
            referencia: v.referencia,
          })),
        );
        setEstado("idle");
      } catch {
        if (!cancelado) setEstado("error");
      }
    }, 260);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [term, open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-11 w-full items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3 text-left text-sm font-medium text-ledger-text shadow-sm transition-colors hover:border-champagne focus-visible:ring-2 focus-visible:ring-champagne/30 focus-visible:outline-none"
        >
          <span className={cn("truncate", !value && "font-normal text-ledger-muted")}>
            {value ? [value.referencia, value.produto, value.label, value.sku].filter(Boolean).join(" · ") : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="pointer-events-auto w-[var(--radix-popover-trigger-width)] min-w-[18rem] overflow-hidden rounded-[12px] p-0 shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 shrink-0 opacity-50" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Referência (LAN…), nome, SKU ou código de barras"
            aria-label="Buscar peça"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div role="listbox" className="max-h-72 overflow-y-auto p-1">
          {estado === "loading" && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Buscando…</p>
          )}
          {estado === "error" && (
            <p className="px-3 py-6 text-center text-sm text-danger">Falha ao buscar peças.</p>
          )}
          {estado === "idle" && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma peça encontrada.
            </p>
          )}
          {estado === "idle" &&
            rows.map((r) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={value?.id === r.id}
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <Check
                  className={cn("mt-0.5 size-4 shrink-0", value?.id === r.id ? "opacity-100" : "opacity-0")}
                />
                <FotoPeca variantId={r.id} alt={r.produto} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.referencia ? <span className="mr-1.5 font-semibold tabular-nums text-primary">{r.referencia}</span> : null}
                    {r.produto}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.label}
                    {r.sku ? ` · ${r.sku}` : ""}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

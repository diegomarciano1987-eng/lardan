import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type SmartOption = {
  value: string;
  label: string;
  hint?: string;
  group?: string;
};

type Props = {
  options: SmartOption[];
  value?: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  id?: string | undefined;
  name?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Mostra o campo de busca a partir deste número de opções. */
  searchThreshold?: number;
};

function normalizar(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SmartSelect({
  options,
  value,
  onChange,
  placeholder = "Selecionar",
  searchPlaceholder = "Buscar...",
  emptyLabel = "Nenhuma opção encontrada.",
  id,
  name,
  disabled,
  required,
  className,
  searchThreshold = 7,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selecionado = options.find((o) => o.value === value);
  const mostrarBusca = options.length >= searchThreshold;

  const filtradas = React.useMemo(() => {
    if (!term.trim()) return options;
    const partes = normalizar(term).split(/\s+/).filter(Boolean);
    return options.filter((o) => {
      const alvo = normalizar(`${o.label} ${o.hint ?? ""} ${o.value}`);
      return partes.every((p) => alvo.includes(p));
    });
  }, [options, term]);

  const grupos = React.useMemo(() => {
    const mapa = new Map<string, SmartOption[]>();
    for (const o of filtradas) {
      const g = o.group ?? "";
      if (!mapa.has(g)) mapa.set(g, []);
      mapa.get(g)!.push(o);
    }
    return Array.from(mapa.entries());
  }, [filtradas]);

  const planas = filtradas;

  React.useEffect(() => {
    if (!open) {
      setTerm("");
      return;
    }
    const idx = planas.findIndex((o) => o.value === value);
    setCursor(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    setCursor(0);
  }, [term]);

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, planas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = planas[cursor];
      if (alvo) {
        onChange(alvo.value);
        setOpen(false);
      }
    }
  }

  return (
    <>
      {name && <input type="hidden" name={name} value={value ?? ""} required={required} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex h-11 w-full items-center justify-between gap-2 rounded-[10px] border border-input bg-transparent px-3 text-left text-sm text-foreground transition-colors",
              "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
              open && "border-foreground/40",
              className,
            )}
          >
            <span className={cn("truncate", !selecionado && "text-muted-foreground")}>
              {selecionado ? selecionado.label : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="pointer-events-auto w-[var(--radix-popover-trigger-width)] min-w-[13rem] overflow-hidden rounded-[12px] border border-border/80 p-0 shadow-xl"
          onKeyDown={teclado}
        >
          {mostrarBusca && (
            <div className="flex items-center gap-2 border-b border-border/70 px-3">
              <Search className="size-4 shrink-0 opacity-50" />
              <input
                autoFocus
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {planas.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
            )}
            {grupos.map(([grupo, itens]) => (
              <div key={grupo || "_"}>
                {grupo && (
                  <p className="px-3 pb-1 pt-3 text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">
                    {grupo}
                  </p>
                )}
                {itens.map((o) => {
                  const idx = planas.indexOf(o);
                  const ativo = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={ativo}
                      data-idx={idx}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm transition-colors",
                        idx === cursor ? "bg-muted" : "bg-transparent",
                      )}
                    >
                      <Check className={cn("size-4 shrink-0", ativo ? "opacity-100" : "opacity-0")} />
                      <span className="flex-1 truncate">{o.label}</span>
                      {o.hint && (
                        <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

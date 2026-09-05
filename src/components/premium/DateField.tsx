import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  value?: Date | undefined;
  onChange: (value?: Date) => void;
  id?: string | undefined;
  name?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  className?: string;
  /** Atalhos rápidos (Hoje / Ontem). */
  shortcuts?: boolean;
};

export function DateField({
  value,
  onChange,
  id,
  name,
  placeholder = "dd/mm/aaaa",
  disabled,
  fromYear = 2015,
  toYear = new Date().getFullYear() + 5,
  className,
  shortcuts = true,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [texto, setTexto] = React.useState(value ? format(value, "dd/MM/yyyy") : "");

  React.useEffect(() => {
    setTexto(value ? format(value, "dd/MM/yyyy") : "");
  }, [value]);

  function digitar(bruto: string) {
    const so = bruto.replace(/\D/g, "").slice(0, 8);
    const mascarado = so
      .replace(/^(\d{2})(\d)/, "$1/$2")
      .replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2");
    setTexto(mascarado);
    if (so.length === 8) {
      const d = parse(mascarado, "dd/MM/yyyy", new Date());
      if (isValid(d)) onChange(d);
    }
    if (so.length === 0) onChange(undefined);
  }

  return (
    <div className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value ? format(value, "yyyy-MM-dd") : ""} />}
      <div
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-[10px] border border-input bg-transparent px-3 transition-colors",
          "focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-ring/30",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          id={id}
          value={texto}
          disabled={disabled}
          inputMode="numeric"
          placeholder={placeholder}
          onChange={(e) => digitar(e.target.value)}
          className="w-full bg-transparent text-sm tabular-nums outline-none placeholder:text-muted-foreground"
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Abrir calendário"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <CalendarDays className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="pointer-events-auto w-auto overflow-hidden rounded-[14px] border border-border/80 p-0 shadow-xl"
          >
            {shortcuts && (
              <div className="flex gap-2 border-b border-border/70 px-3 py-2">
                {[
                  { label: "Hoje", date: new Date() },
                  { label: "Ontem", date: new Date(Date.now() - 864e5) },
                ].map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      onChange(a.date);
                      setOpen(false);
                    }}
                    className="rounded-full border border-border/70 px-3 py-1 text-xs transition-colors hover:bg-muted"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            <Calendar
              mode="single"
              locale={ptBR}
              captionLayout="dropdown"
              formatters={{
                formatMonthDropdown: (d) => format(d, "LLLL", { locale: ptBR }),
              }}
              startMonth={new Date(fromYear, 0)}
              endMonth={new Date(toYear, 11)}
              defaultMonth={value ?? new Date()}
              selected={value}
              onSelect={(d) => {
                onChange(d ?? undefined);
                if (d) setOpen(false);
              }}
              className="pointer-events-auto p-3"
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

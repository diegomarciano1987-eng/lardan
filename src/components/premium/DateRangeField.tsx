import * as React from "react";
import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarRange } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Props = {
  value?: DateRange | undefined;
  onChange: (value?: DateRange) => void;
  id?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  fromYear?: number;
  toYear?: number;
  className?: string;
};

function presets() {
  const hoje = new Date();
  return [
    { label: "Hoje", range: { from: hoje, to: hoje } },
    { label: "Últimos 7 dias", range: { from: subDays(hoje, 6), to: hoje } },
    { label: "Últimos 30 dias", range: { from: subDays(hoje, 29), to: hoje } },
    { label: "Mês atual", range: { from: startOfMonth(hoje), to: endOfMonth(hoje) } },
    {
      label: "Mês anterior",
      range: {
        from: startOfMonth(subMonths(hoje, 1)),
        to: endOfMonth(subMonths(hoje, 1)),
      },
    },
    { label: "Ano atual", range: { from: startOfYear(hoje), to: endOfYear(hoje) } },
  ];
}

function rotulo(v?: DateRange) {
  if (!v?.from) return null;
  const de = format(v.from, "dd/MM/yyyy");
  const ate = v.to ? format(v.to, "dd/MM/yyyy") : null;
  return ate && ate !== de ? `${de} — ${ate}` : de;
}

export function DateRangeField({
  value,
  onChange,
  id,
  placeholder = "Selecionar período",
  disabled,
  fromYear = 2015,
  toYear = new Date().getFullYear() + 5,
  className,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const texto = rotulo(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className={cn(
            "flex h-11 w-full items-center justify-between gap-3 rounded-[10px] border border-input bg-transparent px-3 text-left text-sm transition-colors",
            "hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate tabular-nums", !texto && "text-muted-foreground")}>
            {texto ?? placeholder}
          </span>
          <CalendarRange className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="pointer-events-auto w-auto overflow-hidden rounded-[14px] border border-border/80 p-0 shadow-xl"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row gap-1 overflow-x-auto border-b border-border/70 p-2 sm:w-44 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {presets().map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  onChange(p.range);
                  setOpen(false);
                }}
                className="whitespace-nowrap rounded-[8px] px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="whitespace-nowrap rounded-[8px] px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              Limpar
            </button>
          </div>
          <Calendar
            mode="range"
            locale={ptBR}
            captionLayout="dropdown"
            formatters={{
              formatMonthDropdown: (d) => format(d, "LLLL", { locale: ptBR }),
            }}
            numberOfMonths={1}
            startMonth={new Date(fromYear, 0)}
            endMonth={new Date(toYear, 11)}
            defaultMonth={value?.from ?? new Date()}
            selected={value}
            onSelect={(r) => onChange(r ?? undefined)}
            className="pointer-events-auto p-3 sm:[--cell-size:2.1rem]"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

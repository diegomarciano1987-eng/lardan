import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ptBR } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const daIso = (v?: string) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const [a, m, d] = v.split("-").map(Number);
  const data = new Date(a!, m! - 1, d!);
  return Number.isNaN(data.getTime()) ? undefined : data;
};

const exibir = (v?: string) => {
  const d = daIso(v);
  return d ? d.toLocaleDateString("pt-BR") : "—";
};

export type PresetPeriodo = "hoje" | "semana" | "mes" | "ano" | "personalizado";

/** Intervalos oficiais do departamento financeiro. */
export function intervaloDoPreset(preset: Exclude<PresetPeriodo, "personalizado">) {
  const hoje = new Date();
  if (preset === "hoje") return { de: iso(hoje), ate: iso(hoje) };
  if (preset === "semana") {
    const inicio = new Date(hoje);
    inicio.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    return { de: iso(inicio), ate: iso(fim) };
  }
  if (preset === "ano") {
    return {
      de: iso(new Date(hoje.getFullYear(), 0, 1)),
      ate: iso(new Date(hoje.getFullYear(), 11, 31)),
    };
  }
  return {
    de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    ate: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)),
  };
}

/** Período vigente lido da barra de endereço, com o mês atual como padrão. */
export function usePeriodoFinanceiro() {
  const busca = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const padrao = intervaloDoPreset("mes");
  const de = typeof busca["de"] === "string" ? (busca["de"] as string) : padrao.de;
  const ate = typeof busca["ate"] === "string" ? (busca["ate"] as string) : padrao.ate;
  return { de, ate };
}

const PRESETS: { chave: Exclude<PresetPeriodo, "personalizado">; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "semana", rotulo: "Semana" },
  { chave: "mes", rotulo: "Mês atual" },
  { chave: "ano", rotulo: "Ano" },
];

/**
 * Seletor de período compartilhado por todas as áreas do Financeiro.
 * Grava `de` e `ate` na barra de endereço, mantendo favoritos e recarga.
 */
export function PeriodoGlobal() {
  const navigate = useNavigate();
  const { de, ate } = usePeriodoFinanceiro();
  const [aberto, setAberto] = React.useState(false);
  const [mesVisivel, setMesVisivel] = React.useState<Date>(daIso(de) ?? new Date());

  const aplicar = (novo: { de: string; ate: string }) => {
    void navigate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      search: ((prev: Record<string, unknown>) => ({ ...prev, ...novo })) as any,
      replace: true,
    });
  };

  const ativo = PRESETS.find((p) => {
    const i = intervaloDoPreset(p.chave);
    return i.de === de && i.ate === ate;
  });

  const intervalo = { from: daIso(de), to: daIso(ate) };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-3.5 text-sm font-semibold text-ledger-text transition hover:border-bronze focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
        >
          <span className="ledger-eyebrow text-[0.625rem]">Período</span>
          <span className="tabular-nums">
            {ativo ? ativo.rotulo : `${exibir(de)} – ${exibir(ate)}`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex flex-wrap gap-1.5 border-b border-line-soft p-3">
          {PRESETS.map((p) => (
            <button
              key={p.chave}
              type="button"
              onClick={() => {
                aplicar(intervaloDoPreset(p.chave));
                setAberto(false);
              }}
              className={cn(
                "min-h-9 rounded-[8px] border px-3 text-sm font-semibold transition",
                ativo?.chave === p.chave
                  ? "border-bronze bg-cream-2 text-ledger-text"
                  : "border-line-soft text-ledger-muted hover:border-bronze hover:text-ledger-text",
              )}
            >
              {p.rotulo}
            </button>
          ))}
          <span
            className={cn(
              "min-h-9 rounded-[8px] border px-3 text-sm font-semibold leading-9",
              ativo
                ? "border-line-soft text-ledger-muted"
                : "border-bronze bg-cream-2 text-ledger-text",
            )}
          >
            Personalizado
          </span>
        </div>
        <Calendar
          mode="range"
          locale={ptBR}
          formatters={{
            formatMonthDropdown: (d: Date) => d.toLocaleString("pt-BR", { month: "long" }),
          }}
          selected={intervalo}
          month={mesVisivel}
          onMonthChange={setMesVisivel}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          onSelect={(faixa) => {
            if (!faixa?.from) return;
            const fim = faixa.to ?? faixa.from;
            aplicar({ de: iso(faixa.from), ate: iso(fim) });
            if (faixa.to) setAberto(false);
          }}
          className="pointer-events-auto p-3"
        />
        <p className="border-t border-line-soft px-3 py-2 text-xs font-medium text-ledger-muted">
          {exibir(de)} até {exibir(ate)} — fica na barra de endereço.
        </p>
      </PopoverContent>
    </Popover>
  );
}

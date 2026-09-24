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

  const [rascunho, setRascunho] = React.useState<{ from?: Date | undefined; to?: Date | undefined } | undefined>();
  React.useEffect(() => {
    if (aberto) setRascunho({ from: daIso(de), to: daIso(ate) });
  }, [aberto, de, ate]);
  const intervalo = rascunho ?? { from: daIso(de), to: daIso(ate) };
  const podeAplicar = !!rascunho?.from;

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
          selected={intervalo as never}
          month={mesVisivel}
          onMonthChange={setMesVisivel}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(new Date().getFullYear() + 5, 11)}
          onSelect={(faixa) => setRascunho(faixa ?? undefined)}
          className="pointer-events-auto p-3"
        />
        <div className="flex items-center justify-between gap-3 border-t border-line-soft px-3 py-2.5">
          <p className="text-xs font-medium tabular-nums text-ledger-muted">
            {rascunho?.from ? rascunho.from.toLocaleDateString("pt-BR") : "—"} até{" "}
            {rascunho?.to ? rascunho.to.toLocaleDateString("pt-BR") : rascunho?.from ? rascunho.from.toLocaleDateString("pt-BR") : "—"}
          </p>
          <div className="flex gap-2">
            <button type="button" className="admin-btn" onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="admin-btn-primary"
              disabled={!podeAplicar}
              onClick={() => {
                if (!rascunho?.from) return;
                aplicar({ de: iso(rascunho.from), ate: iso(rascunho.to ?? rascunho.from) });
                setAberto(false);
              }}
            >
              OK
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

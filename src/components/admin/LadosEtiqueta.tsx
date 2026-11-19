import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 1 lado / 2 lados da etiqueta de peça (0342): cada ícone de impressora tem o seu
 * seletor colado ao lado. 1 lado vem sempre marcado; 2 lados vale só para o próximo
 * clique daquela impressora e volta sozinho para 1 lado quando a etiqueta é enviada.
 * Nunca é guardado no computador.
 */
export function useLadosEtiqueta(): [boolean, (v: boolean) => void] {
  return useState(false);
}

export function LadosEtiqueta({ value, onChange, mini = false, className }: { value: boolean; onChange: (v: boolean) => void; mini?: boolean; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Lados da etiqueta"
      title={value ? "Este clique sai em 2 lados; depois volta para 1 lado" : "1 lado (padrão). Para 2 lados, marque 2 lados e clique na impressora ao lado"}
      className={cn("inline-flex shrink-0 items-center rounded-full border border-line bg-surface p-0.5 font-semibold", mini ? "text-[11px]" : "text-xs", className)}
      onClick={(e) => e.stopPropagation()}>
      {([[false, "1 lado"], [true, "2 lados"]] as const).map(([v, rot]) => (
        <button key={rot} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("whitespace-nowrap rounded-full transition", mini ? "min-h-7 px-2" : "min-h-8 px-3", value === v ? "bg-bronze text-primary-foreground" : "text-ledger-muted hover:text-ledger-text")}>
          {rot}
        </button>
      ))}
    </div>
  );
}

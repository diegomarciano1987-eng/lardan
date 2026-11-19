import { useSyncExternalStore } from "react";
import { escolherLados, ladosAtual, ouvirLados } from "@/lib/lados-etiqueta";
import { cn } from "@/lib/utils";

/** 1 lado (sempre o padrão) ou 2 lados só para a próxima impressão; volta sozinho para 1 lado depois de imprimir. */
export function useLadosEtiqueta(): [boolean, (v: boolean) => void] {
  const duplicar = useSyncExternalStore(ouvirLados, ladosAtual, () => false);
  return [duplicar, escolherLados];
}

/** Seletor "1 lado | 2 lados": 1 lado já vem marcado; para 2 lados, marque e depois clique na impressora. */
export function LadosEtiqueta({ className }: { className?: string }) {
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  return (
    <div role="radiogroup" aria-label="Lados da etiqueta" title={duplicar ? "A próxima etiqueta sai em 2 lados; depois volta para 1 lado" : "Etiqueta em 1 lado (padrão). Para 2 lados, marque 2 lados e clique na impressora"}
      className={cn("inline-flex shrink-0 items-center rounded-full border border-line bg-surface p-0.5 text-xs font-semibold", className)}
      onClick={(e) => e.stopPropagation()}>
      {([[false, "1 lado"], [true, "2 lados"]] as const).map(([v, rot]) => (
        <button key={rot} type="button" role="radio" aria-checked={duplicar === v} onClick={() => setDuplicar(v)}
          className={cn("min-h-8 rounded-full px-3 transition", duplicar === v ? "bg-bronze text-primary-foreground" : "text-ledger-muted hover:text-ledger-text")}>
          {rot}
        </button>
      ))}
    </div>
  );
}

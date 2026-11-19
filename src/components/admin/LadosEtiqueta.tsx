import { useEffect, useState } from "react";
import { EVENTO_ESTACAO, lerEstacao, salvarDuplicar } from "@/lib/argox-direta";
import { cn } from "@/lib/utils";

/** Escolha deste computador: etiqueta de peça em 1 lado (padrão) ou 2 lados (a mesma impressão repetida ao lado). */
export function useLadosEtiqueta(): [boolean, (v: boolean) => void] {
  const [duplicar, setDuplicar] = useState(false);
  useEffect(() => {
    const ler = () => setDuplicar(lerEstacao().duplicar === true);
    ler();
    window.addEventListener(EVENTO_ESTACAO, ler);
    window.addEventListener("storage", ler);
    return () => { window.removeEventListener(EVENTO_ESTACAO, ler); window.removeEventListener("storage", ler); };
  }, []);
  return [duplicar, (v: boolean) => { salvarDuplicar(v); setDuplicar(v); }];
}

/** Seletor "1 lado | 2 lados" — vale para todas as etiquetas de peça impressas na Argox deste computador. */
export function LadosEtiqueta({ className }: { className?: string }) {
  const [duplicar, setDuplicar] = useLadosEtiqueta();
  return (
    <div role="radiogroup" aria-label="Lados da etiqueta" title="Vale para todas as etiquetas de peça deste computador"
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

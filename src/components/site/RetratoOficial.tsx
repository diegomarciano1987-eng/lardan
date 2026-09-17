import diamanteAsset from "@/assets/lardan-diamante.png.asset.json";
import { cn } from "@/lib/utils";

/**
 * Slot de fotografia oficial.
 *
 * As fotos de Daniel e Larissa ainda não foram fornecidas pela marca. Nenhuma
 * pessoa é gerada por IA e nenhuma imagem genérica é usada no lugar delas.
 *
 * Para publicar a foto real basta preencher `src` em RETRATOS
 * (src/components/site/retratos.ts): o layout, o aspect ratio e o alt já estão
 * prontos, sem necessidade de redesenhar o componente.
 */
export type Retrato = {
  /** URL da foto oficial (WebP/AVIF). `null` enquanto não fornecida. */
  src: string | null;
  alt: string;
  /** Dimensões reais do arquivo, para evitar CLS. */
  width?: number;
  height?: number;
};

export function RetratoOficial({
  retrato,
  rotulo,
  aspect = "aspect-[4/5]",
  className,
  priority = false,
}: {
  retrato: Retrato;
  /** Texto exibido apenas em desenvolvimento enquanto não há foto. */
  rotulo: string;
  aspect?: string;
  className?: string;
  priority?: boolean;
}) {
  if (retrato.src) {
    return (
      <img
        src={retrato.src}
        alt={retrato.alt}
        {...(retrato.width ? { width: retrato.width } : {})}
        {...(retrato.height ? { height: retrato.height } : {})}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={cn(aspect, "w-full rounded-sm object-cover", className)}
      />
    );
  }

  // Sem foto: área editorial discreta (nunca ícone de imagem quebrada).
  return (
    <div
      aria-hidden="true"
      className={cn(
        aspect,
        "relative w-full overflow-hidden rounded-sm border border-border bg-secondary/50",
        className,
      )}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-60">
        <img src={diamanteAsset.url} alt="" className="h-7 w-auto" width={56} height={35} />
        {import.meta.env.DEV && (
          <span className="brand-eyebrow px-6 text-center text-muted-foreground">{rotulo}</span>
        )}
      </div>
    </div>
  );
}

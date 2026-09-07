/**
 * Miniatura da peça no Estoque. A imagem vem do balde privado por URL
 * assinada em lote (uma chamada por página, nunca uma por linha).
 * Sem foto, o quadro diz a verdade: "Sem foto".
 */
export function StockThumb({
  url,
  alt,
  size = "md",
}: {
  url: string | null | undefined;
  alt: string;
  size?: "md" | "lg";
}) {
  const dim = size === "lg" ? "size-20" : "size-12";
  if (!url) {
    return (
      <div
        className={`${dim} shrink-0 rounded-[10px] border border-dashed border-line bg-surface-muted grid place-items-center`}
        aria-label="Sem foto"
      >
        <span className="text-[0.6rem] font-semibold tracking-[0.08em] text-ledger-muted uppercase">
          Sem foto
        </span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      width={160}
      height={160}
      className={`${dim} shrink-0 rounded-[10px] border border-line object-cover`}
    />
  );
}

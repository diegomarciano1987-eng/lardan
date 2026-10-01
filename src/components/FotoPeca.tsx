import * as React from "react";
import { imagem } from "@/lib/maletas";

/**
 * Miniatura da peça: foto real do catálogo; sem ela, a imagem ilustrativa
 * da vitrine (se existir); sem nenhuma, o quadro vazio.
 */
export function FotoPeca({
  mediaId,
  variantId,
  className,
  vazio,
}: {
  mediaId: string | null | undefined;
  variantId: string | null | undefined;
  className: string;
  vazio?: React.ReactNode;
}) {
  const real = imagem(mediaId);
  const src = real ?? (variantId ? `/api/public/vitrine-ilus/peca/${variantId}` : null);
  const [falhou, setFalhou] = React.useState(false);
  React.useEffect(() => setFalhou(false), [src]);
  if (!src || falhou) return <>{vazio ?? <div className={`${className} bg-surface-muted`} aria-hidden />}</>;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className={`${className} object-cover`}
      onError={() => setFalhou(true)}
      title={real ? undefined : "Imagem ilustrativa"}
    />
  );
}

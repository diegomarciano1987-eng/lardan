/**
 * 0341 — nome da peça sempre com a referência na frente ("LAN0353 · Anel Gota").
 * Use quando a linha não traz a referência pronta; com `referencia` informada não consulta nada.
 */
import { comReferencia, useReferencia } from "@/lib/referencias-pecas";

export function NomePeca({ variantId, nome, referencia, className }: {
  variantId?: string | null | undefined;
  nome: string | null | undefined;
  referencia?: string | null | undefined;
  className?: string;
}) {
  const precisa = !referencia && !!variantId;
  const q = useReferencia(precisa ? variantId : null);
  const ref = referencia || q.data || null;
  if (precisa && q.isLoading) return <span className={className}>{nome ?? "Peça"}</span>;
  return <span className={className}>{comReferencia(ref, nome ?? "Peça")}</span>;
}

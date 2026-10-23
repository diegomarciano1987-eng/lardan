/**
 * Tipo da peça (brinco, anel, colar, pulseira, tornozeleira) pela CATEGORIA do produto (0136),
 * com o mesmo de-para das metas do histórico (legado_categoria_tipo: bracelete conta como pulseira).
 * Sem categoria reconhecida, cai na regra antiga pelo SKU/nome (tipoPeca).
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { tipoPeca, type TipoPeca } from "@/lib/remessa";

const TIPOS: TipoPeca[] = ["brinco", "anel", "colar", "pulseira", "tornozeleira", "outro"];

export async function tiposPelaCategoria(ids: string[]): Promise<Record<string, TipoPeca | null>> {
  const out: Record<string, TipoPeca | null> = {};
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500);
    const { data, error } = await supabase.rpc("variantes_tipo_peca" as never, { _variants: lote } as never);
    if (error) throw error;
    for (const r of (data as unknown as { variant_id: string; tipo: string | null }[]) ?? [])
      out[r.variant_id] = TIPOS.includes(r.tipo as TipoPeca) ? (r.tipo as TipoPeca) : null;
    for (const id of lote) if (!(id in out)) out[id] = null;
  }
  return out;
}

/** Guarda o tipo de cada variante já vista; busca só as novas (a bipagem chama a cada leitura). */
export function useTiposPeca(variantIds: string[]) {
  const [mapa, setMapa] = React.useState<Record<string, TipoPeca | null>>({});
  const pedidos = React.useRef<Set<string>>(new Set());
  const chave = [...new Set(variantIds)].sort().join(",");
  React.useEffect(() => {
    const novos = chave ? chave.split(",").filter((id) => !pedidos.current.has(id)) : [];
    if (novos.length === 0) return;
    novos.forEach((id) => pedidos.current.add(id));
    tiposPelaCategoria(novos)
      .then((m) => setMapa((a) => ({ ...a, ...m })))
      .catch(() => novos.forEach((id) => pedidos.current.delete(id))); // sem permissão/erro: fica a regra antiga
  }, [chave]);
  return React.useCallback(
    (variantId: string, sku: string | null | undefined, nome: string | null | undefined): TipoPeca =>
      mapa[variantId] ?? tipoPeca(sku, nome),
    [mapa],
  );
}

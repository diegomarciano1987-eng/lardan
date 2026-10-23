import { supabase } from "@/integrations/supabase/client";
import type { EtiquetaItem } from "@/lib/etiquetas";

export interface EtiquetaOrigem { productId?: string; variantId?: string; quantidade?: number }
/** Only existing identifiers are read; no write, sequence, stock, cost, or finance operation. */
export async function lerItensEtiquetas(origens: EtiquetaOrigem[]): Promise<EtiquetaItem[]> {
  const result: EtiquetaItem[] = [];
  const productIds = [...new Set(origens.flatMap((o) => o.productId ? [o.productId] : []))];
  const variantIds = [...new Set(origens.flatMap((o) => o.variantId ? [o.variantId] : []))];
  if (productIds.length) {
    const [products, variants] = await Promise.all([
      supabase.from("products").select("id,name,barcode,reference_code").in("id", productIds),
      supabase.from("product_variants").select("id,product_id,label,barcode,reference_code").in("product_id", productIds).eq("is_active", true).order("position"),
    ]);
    if (products.error) throw products.error;
    if (variants.error) throw variants.error;
    for (const p of products.data ?? []) {
      const vs = (variants.data ?? []).filter((v) => v.product_id === p.id);
      const quantidade = origens.find((o) => o.productId === p.id)?.quantidade ?? 1;
      if (vs.length) for (const v of vs) result.push({ id: v.id, nome: `${p.name} ${v.label}`, barcode: v.barcode, referencia: v.reference_code, quantidade });
      else result.push({ id: p.id, nome: p.name, barcode: p.barcode, referencia: p.reference_code, quantidade });
    }
  }
  if (variantIds.length) {
    const { data, error } = await supabase.from("product_variants").select("id,label,barcode,reference_code,products(name)").in("id", variantIds);
    if (error) throw error;
    for (const v of data ?? []) result.push({ id: v.id, nome: `${v.products?.name ?? ""} ${v.label}`.trim(), barcode: v.barcode, referencia: v.reference_code, quantidade: origens.filter((o) => o.variantId === v.id).reduce((sum, o) => sum + (o.quantidade ?? 1), 0) });
  }
  return result;
}
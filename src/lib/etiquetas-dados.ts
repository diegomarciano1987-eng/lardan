import { supabase } from "@/integrations/supabase/client";
import type { EtiquetaItem } from "@/lib/etiquetas";
import { detalheMaleta } from "@/lib/maletas";

export interface EtiquetaOrigem { productId?: string; variantId?: string; cycleId?: string; quantidade?: number }
const nomeEtiqueta = (produto: string, variante: string) => !variante || variante === produto ? produto : variante.startsWith(produto) ? variante : `${produto} ${variante}`;
/** Only existing identifiers are read; no write, sequence, stock, cost, or finance operation. */
export async function lerItensEtiquetas(origens: EtiquetaOrigem[]): Promise<EtiquetaItem[]> {
  const cycles = [...new Set(origens.flatMap((o) => o.cycleId ? [o.cycleId] : []))];
  if (cycles.length) {
    const expanded: EtiquetaOrigem[] = origens.filter((o) => !o.cycleId);
    // Sequential bounded reads reuse the official owner-scoped composition, not direct kit tables.
    for (const cycle of cycles) {
      const d = await detalheMaleta(cycle);
      expanded.push(...d.composicao.map((c) => ({ variantId: c.variant_id, quantidade: c.quantidade })));
    }
    return lerItensEtiquetas(expanded);
  }
  const result: EtiquetaItem[] = [];
  const productIds = [...new Set(origens.flatMap((o) => o.productId ? [o.productId] : []))];
  const variantIds = [...new Set(origens.flatMap((o) => o.variantId ? [o.variantId] : []))];
  if (productIds.length) {
    const [products, variants] = await Promise.all([
      supabase.from("products").select("id,name,barcode,reference_code,price_cents").in("id", productIds),
      supabase.from("product_variants").select("id,product_id,label,barcode,reference_code,price_cents").in("product_id", productIds).eq("is_active", true).order("position"),
    ]);
    if (products.error) throw products.error;
    if (variants.error) throw variants.error;
    for (const p of products.data ?? []) {
      const vs = (variants.data ?? []).filter((v) => v.product_id === p.id);
      const quantidade = origens.find((o) => o.productId === p.id)?.quantidade ?? 1;
      if (vs.length) for (const v of vs) result.push({ id: v.id, nome: nomeEtiqueta(p.name, v.label), barcode: v.barcode, referencia: v.reference_code ?? p.reference_code, precoCents: v.price_cents ?? p.price_cents, quantidade });
      else result.push({ id: p.id, nome: p.name, barcode: p.barcode, referencia: p.reference_code, precoCents: p.price_cents, quantidade });
    }
  }
  if (variantIds.length) {
    const { data, error } = await supabase.from("product_variants").select("id,label,barcode,reference_code,price_cents,products(name,reference_code,price_cents)").in("id", variantIds);
    if (error) throw error;
    for (const v of data ?? []) result.push({ id: v.id, nome: nomeEtiqueta(v.products?.name ?? "", v.label).trim(), barcode: v.barcode, referencia: v.reference_code ?? v.products?.reference_code ?? null, precoCents: v.price_cents ?? v.products?.price_cents ?? null, quantidade: origens.filter((o) => o.variantId === v.id).reduce((sum, o) => sum + (o.quantidade ?? 1), 0) });
  }
  return result;
}

export interface EtiquetaBusca { variantId: string; nome: string; barcode: string | null; referencia: string | null; precoCents: number | null }
/** Busca no servidor (RLS do usuário) por código de barras, referência, SKU ou nome; nunca baixa o catálogo inteiro. */
export async function buscarEtiquetas(termo: string): Promise<EtiquetaBusca[]> {
  const t = termo.trim().replace(/[%,()*]/g, " ").trim();
  if (t.length < 2) return [];
  const like = `%${t}%`;
  const sel = "id,label,barcode,reference_code,sku,price_cents,products!inner(name,reference_code,price_cents,status)";
  const [porVariante, porProduto] = await Promise.all([
    supabase.from("product_variants").select(sel).eq("is_active", true).or(`barcode.eq.${t},reference_code.ilike.${like},sku.ilike.${like},label.ilike.${like}`).limit(30),
    supabase.from("product_variants").select(sel).eq("is_active", true).or(`name.ilike.${like},reference_code.ilike.${like},barcode.eq.${t}`, { referencedTable: "products" }).limit(30),
  ]);
  if (porVariante.error) throw porVariante.error;
  if (porProduto.error) throw porProduto.error;
  const map = new Map<string, EtiquetaBusca>();
  for (const v of [...(porVariante.data ?? []), ...(porProduto.data ?? [])]) {
    const p = v.products as unknown as { name: string; reference_code: string | null; price_cents: number | null; status: string };
    if (p.status === "arquivado") continue;
    map.set(v.id, { variantId: v.id, nome: nomeEtiqueta(p.name, v.label), barcode: v.barcode, referencia: v.reference_code ?? p.reference_code, precoCents: v.price_cents ?? p.price_cents });
  }
  const exato = (r: EtiquetaBusca) => (r.barcode === t || r.referencia?.toUpperCase() === t.toUpperCase() ? 0 : 1);
  return [...map.values()].sort((a, b) => exato(a) - exato(b) || a.nome.localeCompare(b.nome)).slice(0, 30);
}

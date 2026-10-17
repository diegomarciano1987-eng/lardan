import { supabase } from "@/integrations/supabase/client";

export const FORMAS_COMBINADAS = {
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  a_prazo: "A prazo",
} as const;
export type FormaCombinada = keyof typeof FORMAS_COMBINADAS;

export async function salvarCombinado(pedido: string, forma: FormaCombinada | null, parcelas: number, vencimento: string | null) {
  const { error } = await supabase.rpc("consultant_order_combinado_set" as never, {
    _order: pedido, _forma: forma, _parcelas: parcelas, _vencimento: vencimento,
  } as never);
  if (error) throw error;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Ícone visual de cada categoria de joia (botões de filtro rápidos). */
export function iconeCategoria(categoria: string) {
  const c = semAcento(categoria);
  if (!c) return "✦";
  if (c.includes("brinc") || c.includes("argola") || c.includes("ear")) return "◎";
  if (c.includes("anel") || c.includes("aneis")) return "💍";
  if (c.includes("colar") || c.includes("corrent") || c.includes("gargantil")) return "📿";
  if (c.includes("tornozel")) return "〰";
  if (c.includes("pulseir") || c.includes("bracel")) return "◯";
  if (c.includes("conjunt") || c.includes("kit")) return "🎁";
  return "✧";
}

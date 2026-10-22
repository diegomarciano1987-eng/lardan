/** Comissão por maleta pelas faixas configuradas em "Configurações de comissão". */
import { supabase } from "@/integrations/supabase/client";

export type FaixaComissao = { min_cents: number; percentual: number; titulo: string };

export async function faixasComissao(): Promise<FaixaComissao[]> {
  const { data, error } = await supabase.rpc("comissao_faixas_leitura" as never);
  if (error) throw error;
  return ((data as unknown as FaixaComissao[]) ?? []).map((f) => ({ ...f, min_cents: Number(f.min_cents), percentual: Number(f.percentual) }));
}

/** Faixa = a de maior "a partir de" que o vendido alcança. Ex.: 0 e 200 → até 199,99 fica na de 0; 200 em diante na de 200. */
export function faixaPara(vendidoCents: number, faixas: FaixaComissao[]): FaixaComissao | null {
  let achada: FaixaComissao | null = null;
  for (const f of [...faixas].sort((a, b) => a.min_cents - b.min_cents)) if (vendidoCents >= f.min_cents) achada = f;
  return achada;
}

export function comissaoMaleta(vendidoCents: number | null, faixas: FaixaComissao[]) {
  if (vendidoCents == null) return null; // sem acerto: venda desconhecida
  const f = faixaPara(vendidoCents, faixas);
  const comissao = f ? Math.round((vendidoCents * f.percentual) / 100) : 0;
  return { faixa: f, comissao_cents: comissao, repasse_cents: vendidoCents - comissao };
}

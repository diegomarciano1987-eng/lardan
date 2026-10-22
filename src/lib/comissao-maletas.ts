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

type MaletaKit = { remessa: number; kit: number; tipo?: string; fechamento: string | null; valor_vendido_cents: number | null };

/**
 * Regra inviolável: kits da mesma remessa são somados e a faixa vale sobre o total da remessa.
 * A comissão de cada kit é só a parte proporcional do total (para mostrar o detalhe).
 */
export function comissaoPorRemessa<T extends MaletaKit>(maletas: T[], faixas: FaixaComissao[]) {
  const grupos = new Map<number, T[]>();
  for (const m of maletas) if (m.tipo !== "perdida") grupos.set(m.remessa, [...(grupos.get(m.remessa) ?? []), m]);
  return [...grupos.entries()].map(([remessa, kits]) => {
    const acertados = kits.filter((k) => k.fechamento && k.valor_vendido_cents != null);
    const vendido = acertados.length ? acertados.reduce((s, k) => s + (k.valor_vendido_cents ?? 0), 0) : null;
    const c = comissaoMaleta(vendido, faixas);
    const pct = c?.faixa?.percentual ?? 0;
    return {
      remessa, kits, vendido_cents: vendido, faixa: c?.faixa ?? null,
      comissao_cents: c?.comissao_cents ?? null, repasse_cents: c?.repasse_cents ?? null,
      parcial: acertados.length > 0 && acertados.length < kits.length,
      acerto: acertados.map((k) => k.fechamento!).sort().at(-1) ?? null,
      kitComissao: (k: T) => (c && k.fechamento && k.valor_vendido_cents != null ? Math.round((k.valor_vendido_cents * pct) / 100) : null),
    };
  });
}

/**
 * 0335 — tamanhos (aros) de anel que ela mais vende. Base: peças vendidas no SmallData
 * (coluna de tamanho) + acertos do Lardan (tamanho da peça ou os 2 últimos dígitos do código,
 * que são o aro). Anel sem aro (ajustável) conta à parte. Só leitura (consultora_aneis_tamanhos).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TamanhoQtd { tamanho: string; qtd: number; pct: number | null }
export interface AneisTamanhos { total: number; com_tamanho: number; sem_tamanho: number; tamanhos: TamanhoQtd[] }

/** ANEL, Anéis, ANEIS… */
export const ehAnel = (categoria: string | null | undefined) =>
  (categoria ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().startsWith("ANE");

export function useAneisTamanhos(partyId: string | null | undefined) {
  return useQuery({
    queryKey: ["historico", "aneis-tamanhos", partyId],
    enabled: Boolean(partyId),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consultora_aneis_tamanhos" as never, { _party: partyId } as never);
      if (error) throw error;
      return data as unknown as AneisTamanhos;
    },
  });
}

/** "20 (5) · 22 (3) · 18 (1)" — os mais vendidos primeiro. */
export function textoTamanhos(d: AneisTamanhos | null | undefined, max = 5) {
  if (!d || d.tamanhos.length === 0) return null;
  const lista = d.tamanhos.slice(0, max).map((t) => `${t.tamanho} (${t.qtd})`).join(" · ");
  return d.tamanhos.length > max ? `${lista} · +${d.tamanhos.length - max} outros` : lista;
}

/**
 * Linha "Tamanhos mais vendidos" para pôr debaixo da categoria Anel.
 * `vendidasNaCategoria` evita mostrar "sem detalhe" quando ela nem vendeu anel.
 */
export function LinhaTamanhosAnel({ dados, vendidasNaCategoria, className }: {
  dados: AneisTamanhos | null | undefined;
  vendidasNaCategoria?: number | null;
  className?: string;
}) {
  if (!dados) return null;
  const t = textoTamanhos(dados);
  const ajustavel = dados.sem_tamanho > 0 ? ` · ajustável/sem aro: ${dados.sem_tamanho}` : "";
  if (t) {
    return (
      <p className={className ?? "mt-1 text-xs text-ledger-muted"} data-testid="tamanhos-anel">
        <span className="font-semibold">Tamanhos mais vendidos:</span> {t}{ajustavel}
      </p>
    );
  }
  if (dados.sem_tamanho > 0) {
    return (
      <p className={className ?? "mt-1 text-xs text-ledger-muted"} data-testid="tamanhos-anel">
        <span className="font-semibold">Tamanhos:</span> só anéis ajustáveis/sem aro ({dados.sem_tamanho})
      </p>
    );
  }
  if ((vendidasNaCategoria ?? 0) > 0) {
    return (
      <p className={className ?? "mt-1 text-xs text-ledger-muted"} data-testid="tamanhos-anel">
        <span className="font-semibold">Tamanhos:</span> sem detalhe por peça nestas vendas (o histórico importado não traz o aro)
      </p>
    );
  }
  return null;
}

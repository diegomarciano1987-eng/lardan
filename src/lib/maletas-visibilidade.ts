/**
 * Maletas da consultora (0120): Lardan + SmallData na rua + por que ela não vê no app. Só leitura.
 */
import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface MaletaLardan {
  cycle_id: string;
  kit: string;
  kit_nome: string | null;
  status: string;
  remessa: number | null;
  saida: string | null;
  vencimento: string | null;
  pecas: number | null;
  valor_cents: number | null;
  /** null = aparece no app da consultora */
  motivo_invisivel: string | null;
}
export interface MaletaSmallData {
  remessa: number;
  kit: number;
  emissao: string | null;
  vencimento: string | null;
  praca: string | null;
  representante: string | null;
  pecas: number;
  valor_enviado_cents: number;
  dias_na_rua: number | null;
  atrasada: boolean;
  nf_remessa: string | null;
  /** 0127: situação no SmallData (4 = saída conferida, 5 = retorno recebido…) */
  situacao_codigo?: number | null;
  /** 0130: código SmallData da consultora e vencimento antes de pular o acerto */
  codcli?: number;
  vencimento_original?: string | null;
  situacao?: string | null;
  na_rua?: boolean;
}
export interface MaletasConsultora {
  pessoa: { party_id: string; nome: string; codigo: string | null; status: string; tem_login: boolean; login_ativo: boolean; codigos_smalldata: number[] };
  lardan: MaletaLardan[];
  smalldata: MaletaSmallData[];
  mesma_pessoa: { party_id: string; nome: string; codigo: string | null; status: string; motivo: string; tem_login: boolean; maletas_abertas: number }[];
}
export interface VisibilidadeMaletas {
  lardan: { ativas: number; consultoras?: number; invisiveis: number; lista: { cycle_id: string; kit: string; status: string; remessa: number | null; party_id: string | null; consultora: string | null; motivo: string }[] };
  smalldata: {
    /** 0127: número principal é o de consultoras; maletas vem depois (há consultora com várias) */
    consultoras: number;
    maletas: number;
    situacao_importada?: boolean;
    consultoras_varias_maletas?: number;
    sem_cadastro: number;
    pecas: number;
    valor_enviado_cents: number;
    consultoras_atrasadas?: number;
    atrasadas: number;
    por_situacao?: { codigo: number | null; situacao: string; na_rua: boolean; consultoras: number; maletas: number; pecas: number; valor_enviado_cents: number }[];
    por_remessa: { remessa: number; emissao: string | null; vencimento: string | null; praca: string | null; consultoras?: number; maletas: number; pecas: number; valor_enviado_cents: number }[];
    lista: { remessa: number; kit: number; codcli: number; party_id: string | null; consultora: string; emissao: string | null; vencimento: string | null; pecas: number; valor_enviado_cents: number }[];
  };
}

export const maletasDaConsultora = (party: string) => rpc<MaletasConsultora>("consultora_maletas", { _party: party });
export const visibilidadeMaletas = (limite = 300) => rpc<VisibilidadeMaletas>("maletas_visibilidade", { _limite: limite });

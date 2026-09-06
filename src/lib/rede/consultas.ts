import { supabase } from "@/integrations/supabase/client";

/** Filtros compartilhados por mapa, indicadores e painéis. Tudo resolvido no servidor. */
export interface FiltrosRede {
  uf?: string;
  ibge?: string;
  representante?: string;
  carteira?: string;
  regiao?: string;
  nivel?: string;
  situacao?: "todas" | "ativa" | "inativa";
  desde?: string;
  ate?: string;
}

export const FILTROS_REDE_VAZIOS: FiltrosRede = { situacao: "todas" };

export function limparFiltros(f: FiltrosRede): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "" || (k === "situacao" && v === "todas")) continue;
    saida[k] = String(v);
  }
  return saida;
}

export function contarFiltrosAtivos(f: FiltrosRede) {
  return Object.keys(limparFiltros(f)).length;
}

export interface IndicadoresRede {
  total: number;
  ativas: number;
  inativas: number;
  localizadas: number;
  incompletas: number;
  sem_endereco: number;
  aguardando: number;
  falhas: number;
  estados: number;
  municipios: number;
  representantes: number;
  carteiras: number;
}

export interface EstadoRede {
  uf: string;
  nome: string;
  total: number;
  ativas: number;
  localizadas: number;
}

export interface VisaoGeralRede {
  atualizado_em: string;
  escopo_restrito: boolean;
  indicadores: IndicadoresRede;
  estados: EstadoRede[];
}

export async function visaoGeralRede(filtros: FiltrosRede): Promise<VisaoGeralRede> {
  const { data, error } = await supabase.rpc("network_geo_overview", {
    _filtros: limparFiltros(filtros),
  });
  if (error) throw error;
  return data as unknown as VisaoGeralRede;
}

export interface MunicipioRede {
  codigo_ibge: string;
  municipio: string;
  total: number;
  ativas: number;
  localizadas: number;
}

export async function municipiosDaUf(uf: string, filtros: FiltrosRede): Promise<MunicipioRede[]> {
  const { data, error } = await supabase.rpc("network_geo_municipios", {
    _uf: uf,
    _filtros: limparFiltros(filtros),
  });
  if (error) throw error;
  return (data ?? []) as unknown as MunicipioRede[];
}

export interface Territorio {
  uf: string | null;
  ibge: string | null;
  total: number;
  ativas: number;
  inativas: number;
  percentual_rede: number;
  representantes: number;
  carteiras: number;
  enderecos_completos: number;
  enderecos_incompletos: number;
  sem_endereco: number;
  nao_localizadas: number;
  municipios: number;
  ultimas_entradas: {
    nome: string | null;
    codigo: string | null;
    cidade: string | null;
    uf: string | null;
    entrou_em: string;
  }[];
}

export async function territorioRede(
  uf: string | null,
  ibge: string | null,
  filtros: FiltrosRede,
): Promise<Territorio> {
  const { data, error } = await supabase.rpc("network_geo_territorio", {
    _uf: uf,
    _ibge: ibge,
    _filtros: limparFiltros(filtros),
  });
  if (error) throw error;
  return data as unknown as Territorio;
}

export interface PontoRede {
  lat: number;
  lng: number;
  total: number;
  ativas: number;
  aproximado: boolean;
}

export async function pontosRede(filtros: FiltrosRede): Promise<PontoRede[]> {
  const { data, error } = await supabase.rpc("network_geo_pontos", {
    _filtros: limparFiltros(filtros),
  });
  if (error) throw error;
  return ((data ?? []) as unknown as PontoRede[]).map((p) => ({
    ...p,
    lat: Number(p.lat),
    lng: Number(p.lng),
  }));
}

export interface Cobertura {
  estados_atendidos: number;
  estados_sem_cobertura: { uf: string; nome: string }[];
  municipios_atendidos: number;
  municipios_unica_consultora: number;
  municipios_concentrados: { municipio: string; uf: string; total: number }[];
  sem_territorio: number;
  localizacoes_pendentes: number;
  por_representante: { representante: string; total: number; municipios: number }[];
  por_uf: { uf: string; nome: string; total: number }[];
}

export async function coberturaRede(filtros: FiltrosRede): Promise<Cobertura> {
  const { data, error } = await supabase.rpc("network_cobertura", {
    _filtros: limparFiltros(filtros),
  });
  if (error) throw error;
  return data as unknown as Cobertura;
}

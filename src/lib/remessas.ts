import { supabase } from "@/integrations/supabase/client";

export interface RemessaCard {
  id: string;
  numero: number;
  praca_id: string;
  praca: string;
  representante: string | null;
  data_emissao: string;
  data_acerto: string | null;
  status: string;
  maletas: number;
  maletas_conferidas: number;
  consultoras_praca: number;
  pecas: number;
  valor_cents: number;
}

export interface MaletaDaRemessa {
  cycle_id: string;
  consultora_party_id: string | null;
  consultora: string | null;
  status: string;
  pecas: number;
  valor_cents: number;
}

export const STATUS_REMESSA: Record<string, { rotulo: string; tom: "neutral" | "warning" | "success" | "danger" }> = {
  montagem: { rotulo: "Em montagem", tom: "warning" },
  na_rua: { rotulo: "Na rua", tom: "neutral" },
  acerto: { rotulo: "Em acerto", tom: "warning" },
  fechada: { rotulo: "Fechada", tom: "success" },
  cancelada: { rotulo: "Cancelada", tom: "danger" },
};

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as T;
}

export const listarRemessas = (status?: string) =>
  rpc<RemessaCard[]>("remessas_lista", { _status: status && status !== "todas" ? status : null });

export const maletasDaRemessa = (id: string) => rpc<MaletaDaRemessa[]>("remessa_maletas", { _remessa: id });

export const criarRemessa = (p: {
  praca: string;
  numero?: number | null;
  data_emissao?: string | null;
  data_acerto?: string | null;
  representante?: string | null;
  deposito?: string | null;
  observacoes?: string | null;
}) =>
  rpc<{ id: string; numero: number }>("remessa_criar", {
    _praca: p.praca,
    _numero: p.numero ?? null,
    _data_emissao: p.data_emissao ?? null,
    _data_acerto: p.data_acerto ?? null,
    _representante: p.representante ?? null,
    _deposito: p.deposito ?? null,
    _observacoes: p.observacoes ?? null,
  });

export const abrirMaletaNaRemessa = (remessa: string, consultora: string) =>
  rpc<{ cycle_id: string; repetida?: boolean }>("remessa_abrir_maleta", { _remessa: remessa, _consultora: consultora });

export const consultorasDaPraca = async (praca: string, termo: string) => {
  const linhas = await rpc<{ party_id: string; display_name: string }[]>("praca_consultoras", {
    _praca: praca,
    _search: termo.trim() || null,
  });
  return linhas.map((p) => ({ value: p.party_id, label: p.display_name }));
};

export const dataBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
export const isoDia = (d?: Date) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null;

export interface FiltrosRemessa {
  busca?: string;
  status?: string;
  praca?: string;
  representante?: string;
  de?: string | null;
  ate?: string | null;
  campoData?: "emissao" | "acerto";
}

export const buscarRemessas = (f: FiltrosRemessa) =>
  rpc<RemessaCard[]>("remessas_buscar", {
    _busca: f.busca?.trim() || null,
    _status: f.status && f.status !== "todas" ? f.status : null,
    _praca: f.praca || null,
    _representante: f.representante || null,
    _de: f.de ?? null,
    _ate: f.ate ?? null,
    _campo_data: f.campoData ?? "emissao",
  });

// ------------------------------------------------- 0157: tipo de envio (pessoal | correio)
export type TipoEnvio = "pessoal" | "correio";
export const lerEnvioRemessa = (id: string) =>
  rpc<{ tipo_envio: TipoEnvio; prazo_correio_dias: number; postar_ate: string | null } | null>("remessa_envio_ler", { _remessa: id });
export const definirEnvioRemessa = (id: string, tipo: TipoEnvio) =>
  rpc<{ tipo_envio: TipoEnvio; repetido: boolean }>("remessa_tipo_envio_definir", { _remessa: id, _tipo: tipo });

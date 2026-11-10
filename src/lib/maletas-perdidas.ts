/**
 * 0130 — maleta perdida (baixa + fiado), pular acerto e maleta com o representante.
 * Toda regra vive no banco; aqui só há chamada.
 */
import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Mensagem do banco, inteira (as nossas usam ":" no meio da frase). */
export const mensagem = (e: unknown) => (e instanceof Error ? e.message : "Não foi possível concluir.");

/* ------------------------------------------------------------ perdidas --- */
export interface MaletaPerdida {
  id: string;
  origem: "smalldata" | "lardan";
  remessa: number | null;
  codcli: number | null;
  cycle_id: string | null;
  party_id: string | null;
  consultora: string;
  codigo: string | null;
  praca: string | null;
  representante: string | null;
  data_perda: string;
  pecas: number;
  valor_cents: number;
  saldo_cents: number;
  titulo: string | null;
  title_id: string | null;
  situacao: "fiado_gerado" | "sem_cadastro" | "sem_valor";
  ja_tinha_fiado: boolean;
  motivo: string | null;
}
export interface PerdidasResumo {
  maletas: number;
  consultoras: number;
  valor_cents: number;
  em_aberto_cents: number;
  sem_cadastro: number;
  ja_tinham_fiado: number;
}

export const listarPerdidas = (busca?: string, situacao?: string) =>
  rpc<{ resumo: PerdidasResumo; lista: MaletaPerdida[] }>("cob_maletas_perdidas", {
    _busca: busca || null,
    _situacao: situacao || null,
  });

/** Registra as perdidas do SmallData e gera os fiados que faltam (o banco não duplica). */
export const processarPerdidasSmallData = (aplicar: boolean) =>
  rpc<{ perdidas: number; consultoras: number; valor_cents: number; sem_cadastro: number; fiados_gerados_agora: number }>(
    "maletas_perdidas_smalldata_processar",
    { _aplicar: aplicar },
  );

/** Maleta do Lardan: baixa como perdida (estoque sai como perda, sem nota fiscal) e gera o fiado. */
export const baixarMaletaPerdida = (cycleId: string, motivo: string, data?: string) =>
  rpc<{ perdida_id: string; title_id: string | null; pecas: number; valor_cents: number; repetida?: boolean }>("kit_maleta_perdida", {
    _cycle: cycleId,
    _motivo: motivo,
    _data: data || null,
  });

/* -------------------------------------------------------- pular acerto --- */
export const pularAcertoLardan = (cycleId: string, motivo: string, novaData?: string) =>
  rpc<{ de: string | null; para: string }>("kit_pular_acerto", { _cycle: cycleId, _motivo: motivo, _nova: novaData || null });

export const pularAcertoSmallData = (remessa: number, codcli: number, motivo: string, novaData?: string) =>
  rpc<{ de: string | null; para: string }>("legado_maleta_pular_acerto", {
    _remessa: remessa,
    _codcli: codcli,
    _motivo: motivo,
    _nova: novaData || null,
  });

/* ----------------------------------------------- maleta do representante --- */
export const abrirMaletaRepresentante = (remessaId: string) =>
  rpc<{ cycle_id: string; remessa_numero: number }>("remessa_abrir_maleta_representante", { _remessa: remessaId });

export interface MaletasDoRepresentante {
  a_receber: { transfer_id: string; cycle_id: string; maleta: string; remessa: number | null; consultora: string | null; consultora_codigo?: string | null; abertura_numero?: number | null; pecas: number; valor_cents: number; enviada_em: string | null }[];
  sem_consultora: { cycle_id: string; maleta: string; remessa: number | null; praca: string | null; abertura_numero?: number | null; pecas: number; valor_cents: number; acerto: string | null }[];
  para_entregar?: { cycle_id: string; maleta: string; remessa: number | null; consultora: string; consultora_codigo: string | null; abertura_numero?: number | null; telefone: string | null; cidade: string | null; pecas: number; valor_cents: number }[];
  a_caminho: { cycle_id: string; maleta: string; remessa: number | null; consultora: string; abertura_numero?: number | null; pecas: number }[];
}

/** 0278: o mesmo texto do pedido impresso — "ABERTURA 01 · Remessa 925". */
export function rotuloAbertura(numero: number | null | undefined, remessa?: number | null): string | null {
  if (!numero) return null;
  return `ABERTURA ${String(numero).padStart(2, "0")}${remessa ? ` · Remessa ${remessa}` : ""}`;
}
export const maletasDoRepresentante = (rep: string) => rpc<MaletasDoRepresentante>("rep_portal_maletas", { _rep: rep });

export interface Destinataria {
  tipo: "consultora" | "candidata";
  id: string;
  nome: string;
  codigo: string | null;
  cidade: string | null;
}
export const destinatariasDoRepresentante = (rep: string, busca?: string) =>
  rpc<Destinataria[]>("rep_maleta_destinatarias", { _rep: rep, _busca: busca || null });

export const repassarMaleta = (rep: string, cycleId: string, d: Destinataria) =>
  rpc<{ consultora_party_id: string; nova_consultora: boolean }>("rep_maleta_repassar", {
    _rep: rep,
    _cycle: cycleId,
    _consultora: d.tipo === "consultora" ? d.id : null,
    _lead: d.tipo === "candidata" ? d.id : null,
  });

/**
 * 0273: usa uma maleta que está com o representante (mesmo já designada a outra consultora, ainda não
 * entregue) para uma abertura. O banco recusa se algo já aconteceu em nome da consultora original.
 */
export const trocarDestinoMaleta = (rep: string, cycleId: string, d: Destinataria) =>
  rpc<{ consultora_party_id: string; nova_consultora: boolean; consultora_anterior?: string | null; abertura_numero?: number | null }>("rep_maleta_trocar_destino", {
    _rep: rep,
    _cycle: cycleId,
    _consultora: d.tipo === "consultora" ? d.id : null,
    _lead: d.tipo === "candidata" ? d.id : null,
  });

/** 0254: representante entregou em mãos → a consultora confirma "recebi" e faz o aceite no app dela. */
export const entregarEmMaos = (cycleId: string) =>
  rpc<{ transfer_id?: string; repetida?: boolean }>("kit_transfer_forward", { _cycle: cycleId, _payload: { note: "Entregue em mãos pelo representante" } });
export const expedirRemessaRepresentante = (remessaId: string) =>
  rpc<{ maletas: number }>("remessa_expedir_representante", { _remessa: remessaId });
export const devolverCustodiaRepresentante = (cycleId: string, motivo: string) =>
  rpc<{ situacao: string }>("kit_devolver_custodia_representante", { _cycle: cycleId, _motivo: motivo });

export const receberMaleta = (transferId: string) =>
  rpc<{ situacao: string }>("kit_transfer_confirm", { _transfer: transferId, _payload: {} });

export const brl = (cents: number | null | undefined) =>
  ((Number(cents ?? 0)) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBr = (v?: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "—");

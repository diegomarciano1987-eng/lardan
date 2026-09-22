import { supabase } from "@/integrations/supabase/client";

/**
 * Camada única de acesso ao núcleo comercial (maletas, vitrine e pedidos).
 * Toda regra vive no banco; aqui só há chamada e tradução de mensagem.
 */

export type SituacaoMaleta =
  | "rascunho"
  | "montagem"
  | "conferida"
  | "expedida"
  | "transito"
  | "recebida"
  | "operacao"
  | "acerto"
  | "encerrada"
  | "cancelada";

export const SITUACAO_MALETA: Record<string, { rotulo: string; tom: "neutro" | "aviso" | "ok" | "erro" }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  montagem: { rotulo: "Em montagem", tom: "neutro" },
  conferida: { rotulo: "Conferida", tom: "aviso" },
  expedida: { rotulo: "Expedida", tom: "aviso" },
  transito: { rotulo: "Em trânsito", tom: "aviso" },
  recebida: { rotulo: "Com a consultora", tom: "ok" },
  operacao: { rotulo: "Em operação", tom: "ok" },
  acerto: { rotulo: "Em acerto", tom: "aviso" },
  encerrada: { rotulo: "Encerrada", tom: "neutro" },
  cancelada: { rotulo: "Cancelada", tom: "erro" },
};

export interface MaletaCard {
  cycle_id: string;
  kit_id: string;
  codigo: string;
  ciclo: number;
  situacao: SituacaoMaleta;
  pecas: number;
  valor_cents: number;
  consultora: string | null;
  consultora_party_id: string | null;
  representante: string | null;
  custodia: string | null;
  prazo: string | null;
  expedida_em: string | null;
  recebida_em: string | null;
  criada_em: string;
}

export interface ItemComposicao {
  variant_id: string;
  produto: string;
  variante: string | null;
  sku: string | null;
  quantidade: number;
  valor_unitario: number;
  media_id: string | null;
}

export interface SaldoMaleta {
  variant_id: string;
  produto: string;
  variante: string | null;
  alocado: number;
  aceito: number;
  divergente: number;
  vendido: number;
  reservado: number;
  disponivel: number;
  publicado: boolean;
  media_id: string | null;
}

export interface EntregaMaleta {
  id: string;
  seq: number;
  situacao: "pendente" | "transito" | "entregue" | "recusada" | "cancelada";
  de: string | null;
  para: string | null;
  para_party_id: string | null;
  transportadora: string | null;
  rastreio: string | null;
  enviada_em: string | null;
  entregue_em: string | null;
  recusada_em: string | null;
  motivo: string | null;
}

export interface EventoMaleta {
  kind: string;
  de: string | null;
  para: string | null;
  quando: string;
  payload: Record<string, unknown>;
  motivo: string | null;
}

export interface DetalheMaleta {
  ciclo: {
    id: string;
    status: SituacaoMaleta;
    cycle_no: number;
    consultora_party_id: string | null;
    representante_party_id: string | null;
    custodian_party_id: string | null;
    quantity_total: number;
    reference_total_cents: number;
    due_at: string | null;
    shipped_at: string | null;
    received_at: string | null;
    notes: string | null;
    created_at: string;
  };
  maleta: { id: string; codigo: string; etiqueta: string | null; qr_token: string };
  consultora: string | null;
  representante: string | null;
  custodia: string | null;
  composicao: ItemComposicao[];
  saldos: SaldoMaleta[];
  entregas: EntregaMaleta[];
  eventos: EventoMaleta[];
}

export interface PedidoResumo {
  id: string;
  code: string;
  consultora_party_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  customer_note: string | null;
  channel: string;
  status: "aguardando_atendimento" | "em_atendimento" | "aguardando_pagamento" | "concluido" | "cancelado";
  payment_status: string;
  delivery_status: string;
  subtotal_cents: number;
  items_count: number;
  reserve_expires_at: string | null;
  created_at: string;
}

export const SITUACAO_PEDIDO: Record<string, { rotulo: string; tom: "neutro" | "aviso" | "ok" | "erro" }> = {
  aguardando_atendimento: { rotulo: "Aguardando atendimento", tom: "aviso" },
  em_atendimento: { rotulo: "Em atendimento", tom: "aviso" },
  aguardando_pagamento: { rotulo: "Aguardando pagamento", tom: "aviso" },
  concluido: { rotulo: "Concluído", tom: "ok" },
  cancelado: { rotulo: "Cancelado", tom: "erro" },
};

export interface ItemPedido {
  id: string;
  cycle_id: string | null;
  variant_id: string;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  unit_price_cents: number;
}

export interface DetalhePedido {
  pedido: PedidoResumo;
  consultora: string | null;
  itens: ItemPedido[];
  eventos: { kind: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string }[];
}

export interface VitrineItem {
  cycle_id: string;
  variant_id: string;
  produto: string;
  slug: string;
  variante: string | null;
  tamanho: string | null;
  cor: string | null;
  categoria: string | null;
  disponivel: number;
  preco_cents: number;
  media_id: string | null;
}

export interface VitrinePublica {
  slug: string;
  nome: string;
  headline: string | null;
  bio: string | null;
  whatsapp: string | null;
  itens: VitrineItem[];
}

/** Mensagem do banco sem ruído técnico. */
export function traduzir(erro: unknown) {
  const m = (erro as { message?: string } | null)?.message ?? "Não foi possível concluir.";
  return m.replace(/^.*?:\s*/, "").trim() || "Não foi possível concluir.";
}

async function rpc<T>(nome: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(nome as never, args as never);
  if (error) throw error;
  return data as T;
}

/* ---------------- maletas ---------------- */
export const listarMaletas = (situacao?: string, pagina = 0, tamanho = 200) =>
  rpc<MaletaCard[]>("kit_board", {
    _filtros: situacao && situacao !== "todas" ? { situacao } : {},
    _limit: tamanho,
    _offset: pagina * tamanho,
  });

export const detalheMaleta = (cycleId: string) => rpc<DetalheMaleta>("kit_detail", { _cycle: cycleId });

export const criarCiclo = (payload: {
  consultora_party_id?: string | null;
  representante_party_id?: string | null;
  origin_location_id?: string | null;
  label?: string | null;
  due_at?: string | null;
  notes?: string | null;
}) => rpc<{ cycle_id: string; code: string; qr_token: string }>("kit_cycle_create", { _payload: payload });

export const definirItem = (cycleId: string, variantId: string, qty: number) =>
  rpc<unknown>("kit_item_upsert", { _cycle: cycleId, _variant: variantId, _qty: qty });

export const conferir = (cycleId: string, nota?: string) =>
  rpc<{ situacao: string; repetida?: boolean }>("kit_conferir", { _cycle: cycleId, _note: nota ?? null });

export const expedir = (
  cycleId: string,
  payload: { rota?: "direta" | "representante"; carrier?: string; tracking_code?: string; note?: string },
) => rpc<{ situacao: string; rota: string }>("kit_expedir", { _cycle: cycleId, _payload: payload });

export const confirmarEntrega = (transferId: string, payload: { recusar?: boolean; motivo?: string } = {}) =>
  rpc<{ situacao: string; repetida?: boolean }>("kit_transfer_confirm", { _transfer: transferId, _payload: payload });

export const encaminhar = (cycleId: string, payload: { carrier?: string; tracking_code?: string; note?: string } = {}) =>
  rpc<{ situacao?: string; repetida?: boolean }>("kit_transfer_forward", { _cycle: cycleId, _payload: payload });

export type TipoDivergencia = "faltante" | "defeito";

/**
 * A conferência precisa classificar TODAS as peças enviadas:
 * aceitas + divergentes tem de somar exatamente o que foi expedido.
 */
export const aceitar = (
  cycleId: string,
  itens: {
    variant_id: string;
    qty_accepted: number;
    qty_divergent: number;
    tipo_divergencia?: TipoDivergencia;
    motivo?: string;
  }[],
  chave: string,
) => rpc<{ acceptance_id: string; repetida?: boolean }>("kit_aceitar", {
  _cycle: cycleId,
  _itens: itens,
  _idempotency_key: chave,
});

export const publicarPeca = (cycleId: string, variantId: string, publicar: boolean) =>
  rpc<unknown>("kit_item_publish", { _cycle: cycleId, _variant: variantId, _publicar: publicar });

/* ---------------- vitrine ---------------- */
export const salvarVitrine = (payload: {
  slug: string;
  headline?: string;
  bio?: string;
  whatsapp?: string;
  is_public: boolean;
}) => rpc<{ slug: string }>("showcase_save", { _payload: payload });

export async function minhaVitrine() {
  const { data, error } = await supabase
    .from("consultant_showcases")
    .select("party_id, slug, headline, bio, whatsapp, is_public")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const vitrinePublica = (slug: string) => rpc<VitrinePublica | null>("showcase_public", { _slug: slug });

export const enviarPedido = (
  slug: string,
  cliente: { nome: string; telefone?: string; email?: string; observacao?: string; canal?: string },
  itens: { cycle_id: string; variant_id: string; quantidade: number }[],
  chave: string,
) => rpc<{ order_id: string; codigo: string; total_cents: number; repetido?: boolean }>("showcase_order_create", {
  _slug: slug,
  _cliente: cliente,
  _itens: itens,
  _idempotency_key: chave,
});

/* ---------------- pedidos ---------------- */
export const listarPedidos = (status?: string) =>
  rpc<PedidoResumo[]>("orders_list", { _filtros: status && status !== "todos" ? { status } : {} });

export const detalhePedido = (id: string) => rpc<DetalhePedido>("order_detail", { _order: id });

export const mudarSituacaoPedido = (id: string, status: string, nota?: string) =>
  rpc<{ situacao: string; repetido?: boolean }>("order_set_status", { _order: id, _status: status, _note: nota ?? null });

/* ---------------- utilidades ---------------- */
export const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents ?? 0) / 100);

export const imagem = (mediaId: string | null | undefined) =>
  mediaId ? `/api/public/midia/${mediaId}` : null;

export const chaveIdempotencia = () =>
  (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

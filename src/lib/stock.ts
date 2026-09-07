import { supabase } from "@/integrations/supabase/client";

export type StockMoveKind = "entrada" | "saida" | "transferencia" | "ajuste" | "inventario";

export const MOVE_LABEL: Record<StockMoveKind, string> = {
  entrada: "Entrada",
  saida: "Saída",
  transferencia: "Transferência",
  ajuste: "Ajuste",
  inventario: "Inventário",
};

export interface StockOverview {
  locais?: number;
  pecas_com_saldo?: number;
  unidades?: number;
  negativos?: number;
  movimentos_7d?: number;
}

export interface BalanceRow {
  id: string;
  quantity: number;
  reserved: number;
  /** Disponível = físico − reservado, calculado no servidor. */
  available: number;
  updated_at: string;
  local_id: string;
  local_nome: string;
  local_codigo: string;
  variant_id: string;
  variante: string;
  sku: string | null;
  barcode: string | null;
  legacy_code: string | null;
  produto_id: string;
  produto: string;
  produto_slug: string;
  media_id: string | null;
  media_path: string | null;
}

export interface MovementRow {
  id: string;
  kind: StockMoveKind;
  quantity: number;
  unit_cost_cents: number | null;
  reason_code: string | null;
  motivo: string | null;
  reference: string | null;
  note: string | null;
  balance_after: number | null;
  balance_from_before: number | null;
  balance_from_after: number | null;
  balance_to_before: number | null;
  balance_to_after: number | null;
  created_at: string;
  autor: string | null;
  variant_id: string;
  variante: string | null;
  sku: string | null;
  produto: string | null;
  media_id: string | null;
  media_path: string | null;
  origem: string | null;
  destino: string | null;
}

export interface StockItemDetail {
  variant_id: string;
  variante: string;
  sku: string | null;
  barcode: string | null;
  legacy_code: string | null;
  is_active: boolean;
  produto_id: string;
  produto: string;
  produto_slug: string;
  produto_status: string;
  categoria: string | null;
  colecao: string | null;
  reservas_ativas: boolean;
  pode_ver_reserva?: boolean;
  reservas_ativas_qtd?: number | null;
  proxima_a_vencer?: { id: string; protocolo: string; validade: string; quantidade: number } | null;
  reservas?: ReservationRow[];
  pode_ver_custo: boolean;
  custo_cents: number | null;
  midias: { id: string; path: string | null; alt: string | null }[];
  saldos: {
    local_id: string;
    local: string;
    codigo: string;
    quantity: number;
    reserved: number;
    available: number;
    updated_at: string;
  }[];
  ultima_movimentacao: {
    id: string;
    kind: StockMoveKind;
    quantity: number;
    created_at: string;
    reason_code: string | null;
    reference: string | null;
    unit_cost_cents?: number | null;
    origem: string | null;
    destino: string | null;
    autor: string | null;
  } | null;
}

export interface StockReason {
  id: string;
  code: string;
  label: string;
  kind: StockMoveKind;
}

/** Resumo do estoque calculado no banco. Sem número inventado. */
export async function fetchStockOverview(): Promise<StockOverview> {
  const { data, error } = await supabase.rpc("stock_overview");
  if (error) throw error;
  return (data ?? {}) as StockOverview;
}

/**
 * Saldos resolvidos no servidor: busca por produto, variação, SKU, código
 * legado e código de barras, já trazendo a foto principal de cada peça.
 */
export async function listBalances(params: {
  search: string;
  page: number;
  pageSize: number;
  locationId?: string | undefined;
  onlyPositive?: boolean;
  signal?: AbortSignal;
}) {
  const { search, page, pageSize, locationId, onlyPositive, signal } = params;
  const termo = search.trim();
  const args: Record<string, unknown> = {
    _page: page,
    _size: pageSize,
    _only_positive: onlyPositive ?? false,
  };
  if (termo.length >= 2) args["_search"] = termo;
  if (locationId) args["_location"] = locationId;

  let req = supabase.rpc("stock_balances_list", args as never);
  if (signal) req = req.abortSignal(signal);
  const { data, error } = await req;
  if (error) throw error;
  const payload = (data ?? {}) as {
    rows?: BalanceRow[];
    total?: number;
    reservas_ativas?: boolean;
  };
  return {
    rows: payload.rows ?? [],
    total: Number(payload.total ?? 0),
    reservasAtivas: payload.reservas_ativas ?? false,
  };
}

/** Uma única chamada assinada por página; nunca uma URL por linha. */
export async function signedMediaMap(paths: (string | null | undefined)[]) {
  const limpos = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const mapa: Record<string, string> = {};
  if (limpos.length === 0) return mapa;
  const { data } = await supabase.storage.from("media").createSignedUrls(limpos, 3600);
  (data ?? []).forEach((u, i) => {
    const caminho = limpos[i];
    if (caminho && u.signedUrl) mapa[caminho] = u.signedUrl;
  });
  return mapa;
}

/** Ficha completa do item de estoque (painel lateral). */
export async function fetchStockItem(variantId: string): Promise<StockItemDetail> {
  const { data, error } = await supabase.rpc("stock_item_detail", {
    _variant: variantId,
  } as never);
  if (error) throw error;
  return data as unknown as StockItemDetail;
}

/**
 * Movimentações sempre pelo servidor. O custo unitário não é legível na
 * Data API: só volta preenchido para quem tem `stock.cost.view`.
 */
export async function listMovements(params: {
  search: string;
  page: number;
  pageSize: number;
  kind?: string | undefined;
  variantId?: string | undefined;
  signal?: AbortSignal;
}) {
  const { search, page, pageSize, kind, variantId, signal } = params;
  const args: Record<string, unknown> = { _page: page, _size: pageSize };
  const termo = search.trim();
  if (termo.length >= 2) args["_search"] = termo;
  if (kind && kind !== "todos") args["_kind"] = kind;
  if (variantId) args["_variant"] = variantId;

  let req = supabase.rpc("stock_movements_list", args as never);
  if (signal) req = req.abortSignal(signal);
  const { data, error } = await req;
  if (error) throw error;
  const payload = (data ?? {}) as {
    rows?: MovementRow[];
    total?: number;
    pode_ver_custo?: boolean;
  };
  const rows: MovementRow[] = (payload.rows ?? []).map((r) => ({
    ...r,
    unit_cost_cents: r.unit_cost_cents ?? null,
  }));
  return { rows, total: Number(payload.total ?? 0), podeVerCusto: payload.pode_ver_custo ?? false };
}

export async function listStockReasons(): Promise<StockReason[]> {
  const { data, error } = await supabase
    .from("stock_reasons")
    .select("id, code, label, kind")
    .eq("is_active", true)
    .order("label");
  if (error) throw error;
  return (data ?? []) as StockReason[];
}

export async function listStockLocations() {
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, code, kind")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** Busca de peças no servidor, por nome do produto, variação, SKU ou código de barras. */
export async function searchVariants(term: string, limit = 20) {
  const termo = term.trim().replace(/[,()]/g, " ");
  let query = supabase
    .from("product_variants")
    .select("id, label, sku, barcode, products!inner(name)")
    .eq("is_active", true)
    .order("label")
    .limit(limit);
  if (termo.length >= 2) {
    query = query.or(`label.ilike.%${termo}%,sku.ilike.%${termo}%,barcode.ilike.%${termo}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as {
    id: string;
    label: string;
    sku: string | null;
    barcode: string | null;
    products: { name: string } | null;
  }[];
}

export interface MovementInput {
  kind: StockMoveKind;
  variantId: string;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reasonCode?: string | null;
  unitCostCents?: number | null;
  reference?: string | null;
  note?: string | null;
  /** Chave de repetição: reenviar a mesma operação não cria outro movimento. */
  idempotencyKey?: string | null;
}

/**
 * Grava a movimentação e o saldo na mesma transação do banco.
 * A chave de repetição evita duplicar o lançamento em clique duplo ou reenvio.
 */
export async function registerMovement(input: MovementInput) {
  const args: Record<string, unknown> = {
    _kind: input.kind,
    _variant_id: input.variantId,
    _quantity: input.quantity,
    _idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
  };
  if (input.fromLocationId) args["_from_location_id"] = input.fromLocationId;
  if (input.toLocationId) args["_to_location_id"] = input.toLocationId;
  if (input.reasonCode) args["_reason_code"] = input.reasonCode;
  if (input.unitCostCents !== null && input.unitCostCents !== undefined)
    args["_unit_cost_cents"] = input.unitCostCents;
  if (input.reference) args["_reference"] = input.reference;
  if (input.note) args["_note"] = input.note;

  const { data, error } = await supabase.rpc(
    "register_stock_movement",
    args as never,
  );
  if (error) throw error;
  return data as string;
}


/* ============================================================
 * Reservas de estoque
 * físico = quantidade no local · reservado = reservas ativas
 * disponível = físico − reservado (sempre calculado no servidor)
 * ============================================================ */

export type ReservationStatus =
  | "ativa"
  | "confirmada"
  | "liberada"
  | "vencida"
  | "cancelada";

export const RESERVATION_LABEL: Record<ReservationStatus, string> = {
  ativa: "Ativa",
  confirmada: "Confirmada",
  liberada: "Liberada",
  vencida: "Vencida",
  cancelada: "Cancelada",
};

export interface ReservationRow {
  id: string;
  protocolo: string;
  situacao: ReservationStatus;
  quantidade: number;
  origem: string;
  referencia: string | null;
  pessoa: string | null;
  party_id: string | null;
  observacao: string | null;
  criada_em: string;
  validade: string;
  confirmada_em: string | null;
  liberada_em: string | null;
  motivo_cancelamento: string | null;
  movimento_id: string | null;
  autor: string | null;
  variant_id: string;
  variante: string | null;
  sku: string | null;
  produto_id?: string;
  produto: string | null;
  local_id?: string;
  local: string | null;
  local_codigo?: string | null;
  media_path?: string | null;
}

export interface ReservationDetail extends ReservationRow {
  historico: { acao: string; em: string; autor: string | null; dados: unknown }[];
}

/** Lista de reservas resolvida no servidor: busca, filtros e paginação. */
export async function listReservations(params: {
  search?: string;
  status?: string;
  locationId?: string;
  origin?: string;
  validade?: string;
  variantId?: string;
  page: number;
  pageSize: number;
  signal?: AbortSignal;
}) {
  const args: Record<string, unknown> = { _page: params.page, _size: params.pageSize };
  const termo = (params.search ?? "").trim();
  if (termo.length >= 2) args["_search"] = termo;
  if (params.status && params.status !== "todas") args["_status"] = params.status;
  if (params.locationId && params.locationId !== "todos") args["_location"] = params.locationId;
  if (params.origin && params.origin !== "todas") args["_origin"] = params.origin;
  if (params.validade && params.validade !== "todas") args["_validade"] = params.validade;
  if (params.variantId) args["_variant"] = params.variantId;

  let req = supabase.rpc("stock_reservations_list", args as never);
  if (params.signal) req = req.abortSignal(params.signal);
  const { data, error } = await req;
  if (error) throw error;
  const payload = (data ?? {}) as { rows?: ReservationRow[]; total?: number };
  return { rows: payload.rows ?? [], total: Number(payload.total ?? 0) };
}

export async function fetchReservation(id: string): Promise<ReservationDetail> {
  const { data, error } = await supabase.rpc("stock_reservation_detail", {
    _reservation_id: id,
  } as never);
  if (error) throw error;
  return data as unknown as ReservationDetail;
}

export interface ReservationInput {
  variantId: string;
  locationId: string;
  quantity: number;
  expiresAt: string;
  origin?: string;
  reference?: string | null;
  partyId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}

/** Cria a reserva na mesma transação em que o disponível é calculado. */
export async function createReservation(input: ReservationInput) {
  const args: Record<string, unknown> = {
    _variant_id: input.variantId,
    _location_id: input.locationId,
    _quantity: input.quantity,
    _expires_at: input.expiresAt,
    _origin: input.origin ?? "manual",
    _idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
  };
  if (input.reference) args["_reference"] = input.reference;
  if (input.partyId) args["_party_id"] = input.partyId;
  if (input.note) args["_note"] = input.note;
  const { data, error } = await supabase.rpc("create_stock_reservation", args as never);
  if (error) throw error;
  return data as unknown as { id: string; protocolo: string; situacao: string };
}

/** Confirma a reserva: vira saída física única, mesmo se o clique repetir. */
export async function confirmReservation(id: string, opts?: { reference?: string; note?: string }) {
  const args: Record<string, unknown> = { _reservation_id: id };
  if (opts?.reference) args["_reference"] = opts.reference;
  if (opts?.note) args["_note"] = opts.note;
  const { data, error } = await supabase.rpc("confirm_stock_reservation", args as never);
  if (error) throw error;
  return data as unknown as { protocolo: string; situacao: string; movimento_id: string };
}

/** Libera (sem motivo) ou cancela (com motivo obrigatório). */
export async function releaseReservation(id: string, cancelar: boolean, motivo?: string) {
  const args: Record<string, unknown> = { _reservation_id: id, _cancelar: cancelar };
  if (motivo) args["_reason"] = motivo;
  const { data, error } = await supabase.rpc("release_stock_reservation", args as never);
  if (error) throw error;
  return data as unknown as { protocolo: string; situacao: string };
}

/** Saldo de um local para a peça escolhida (físico, reservado e disponível). */
export async function fetchVariantBalances(variantId: string) {
  const d = await fetchStockItem(variantId);
  return d.saldos ?? [];
}

/** Busca de pessoas para vincular a reserva (opcional). */
export async function searchParties(term: string, limit = 20) {
  const termo = term.trim();
  let q = supabase
    .from("parties")
    .select("id, display_name, doc_masked")
    .eq("is_active", true)
    .order("display_name")
    .limit(limit);
  if (termo.length >= 2) q = q.ilike("display_name", `%${termo}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as { id: string; display_name: string; doc_masked: string | null }[];
}

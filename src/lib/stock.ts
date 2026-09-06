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
  updated_at: string;
  locations: { id: string; name: string; code: string } | null;
  product_variants: {
    id: string;
    label: string;
    sku: string | null;
    barcode: string | null;
    products: { id: string; name: string } | null;
  } | null;
}

export interface MovementRow {
  id: string;
  kind: StockMoveKind;
  quantity: number;
  unit_cost_cents: number | null;
  reason_code: string | null;
  reference: string | null;
  note: string | null;
  balance_after: number | null;
  created_at: string;
  product_variants: {
    label: string;
    sku: string | null;
    products: { name: string } | null;
  } | null;
  origem: { name: string } | null;
  destino: { name: string } | null;
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

const BALANCE_SELECT =
  "id, quantity, reserved, updated_at, locations!inner(id, name, code), product_variants!inner(id, label, sku, barcode, products!inner(id, name))";

export async function listBalances(params: {
  search: string;
  page: number;
  pageSize: number;
  locationId?: string | undefined;
  onlyPositive?: boolean;
}) {
  const { search, page, pageSize, locationId, onlyPositive } = params;
  let query = supabase
    .from("stock_balances")
    .select(BALANCE_SELECT, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (locationId) query = query.eq("location_id", locationId);
  if (onlyPositive) query = query.gt("quantity", 0);

  const termo = search.trim().replace(/[,()]/g, " ");
  if (termo.length >= 2) {
    query = query.or(`label.ilike.%${termo}%,sku.ilike.%${termo}%,barcode.ilike.%${termo}%`, {
      referencedTable: "product_variants",
    });
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as BalanceRow[], total: count ?? 0 };
}

const MOVEMENT_SELECT =
  "id, kind, quantity, unit_cost_cents, reason_code, reference, note, balance_after, created_at, product_variants!inner(label, sku, products!inner(name)), origem:locations!stock_movements_from_location_id_fkey(name), destino:locations!stock_movements_to_location_id_fkey(name)";

export async function listMovements(params: {
  search: string;
  page: number;
  pageSize: number;
  kind?: string | undefined;
  variantId?: string | undefined;
}) {
  const { search, page, pageSize, kind, variantId } = params;
  let query = supabase
    .from("stock_movements")
    .select(MOVEMENT_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (kind && kind !== "todos") query = query.eq("kind", kind as StockMoveKind);
  if (variantId) query = query.eq("variant_id", variantId);

  const termo = search.trim().replace(/[,()]/g, " ");
  if (termo.length >= 2) {
    query = query.or(`label.ilike.%${termo}%,sku.ilike.%${termo}%`, {
      referencedTable: "product_variants",
    });
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as MovementRow[], total: count ?? 0 };
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


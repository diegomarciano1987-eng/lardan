import { supabase } from "@/integrations/supabase/client";
import { onlyDigits } from "@/lib/docs-br";

/**
 * Central de Cadastros — camada de acesso à identidade canônica.
 * Uma pessoa/empresa existe uma única vez em `parties`; os papéis dizem o que
 * ela é (consultora, fornecedor, colaborador…). Nada aqui duplica registros
 * dos módulos especializados: eles apontam para a mesma linha.
 */

export type PartyKind = "pessoa" | "organizacao";

export type PartyStatus =
  | "rascunho"
  | "em_analise"
  | "aprovado"
  | "ativo"
  | "bloqueado"
  | "inativo"
  | "desligado";

export const PARTY_STATUS_LABEL: Record<PartyStatus, string> = {
  rascunho: "Rascunho",
  em_analise: "Em análise",
  aprovado: "Aprovado",
  ativo: "Ativo",
  bloqueado: "Bloqueado",
  inativo: "Inativo",
  desligado: "Desligado",
};

export type PartyRoleKind =
  | "candidata"
  | "consultora"
  | "revendedora"
  | "representante"
  | "colaborador"
  | "cliente"
  | "fornecedor"
  | "entidade_grupo"
  | "transportadora"
  | "prestador"
  | "custodiante"
  | "usuario";

export const PARTY_ROLE_LABEL: Record<PartyRoleKind, string> = {
  candidata: "Candidata",
  consultora: "Consultora",
  revendedora: "Revendedora",
  representante: "Representante",
  colaborador: "Colaborador",
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  entidade_grupo: "Entidade do grupo",
  transportadora: "Transportadora",
  prestador: "Prestador",
  custodiante: "Custodiante",
  usuario: "Usuária do sistema",
};

export interface Party {
  id: string;
  kind: PartyKind;
  code: string;
  display_name: string | null;
  legal_name: string | null;
  social_name: string | null;
  doc: string | null;
  doc_digits: string | null;
  rg: string | null;
  rg_issuer: string | null;
  birth_date: string | null;
  profession: string | null;
  marital_status: string | null;
  notes: string | null;
  status: PartyStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContactPoint {
  id: string;
  party_id: string;
  kind: "whatsapp" | "telefone" | "email";
  label: string | null;
  value: string;
  is_primary: boolean;
}

export interface PartyAddress {
  id: string;
  party_id: string;
  label: string | null;
  postal_code: string | null;
  street: string | null;
  street_number: string | null;
  no_number: boolean;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  reference: string | null;
  is_primary: boolean;
}

export interface PartyRoleRow {
  id: string;
  party_id: string;
  role: PartyRoleKind;
  status: PartyStatus;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
}

export interface ConsultantProfile {
  party_id: string;
  origin: string | null;
  joined_at: string | null;
  region: string | null;
  wallet: string | null;
  level: string | null;
  goal_cents: number | null;
  cycle: string | null;
  sale_profile: string | null;
  experience: string | null;
  audience: string | null;
  availability: string | null;
  block_reason: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
  pix_holder: string | null;
  pix_holder_doc: string | null;
  bank_info: string | null;
  credit_limit_cents: number | null;
  financial_status: string | null;
  restricted_notes: string | null;
}

export interface SearchHit {
  grupo: string;
  tipo: string;
  entity_id: string;
  titulo: string;
  subtitulo: string | null;
  selo: string | null;
  rota: string;
}

/** Busca unificada — sempre no servidor, respeitando RLS e permissões. */
export async function searchRegistry(term: string, signal?: AbortSignal) {
  const query = supabase.rpc("search_registry", { _term: term, _limit: 8 });
  if (signal) query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}

export type RegistryCounts = Record<string, number>;

export async function registryCounts(): Promise<RegistryCounts> {
  const { data, error } = await supabase.rpc("registry_counts");
  if (error) throw error;
  return (data ?? {}) as RegistryCounts;
}

export interface DuplicateRow {
  motivo: string;
  chave: string | null;
  quantidade: number;
  ids: string[];
}

export async function registryDuplicates(limit = 50) {
  const { data, error } = await supabase.rpc("registry_duplicates", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as DuplicateRow[];
}

export interface ListPartiesParams {
  search: string;
  page: number;
  pageSize: number;
  kind?: PartyKind | "todos";
  role?: PartyRoleKind | "todos";
  status?: PartyStatus | "todos";
}

/** Listagem paginada e ordenada no servidor. Nunca baixa a base inteira. */
export async function listParties(params: ListPartiesParams) {
  const { search, page, pageSize, kind, role, status } = params;
  let ids: string[] | null = null;

  if (role && role !== "todos") {
    const { data, error } = await supabase
      .from("party_roles")
      .select("party_id")
      .eq("role", role)
      .limit(5000);
    if (error) throw error;
    ids = (data ?? []).map((r) => r.party_id);
    if (ids.length === 0) return { rows: [] as Party[], total: 0 };
  }

  let q = supabase
    .from("parties")
    .select(
      "id, kind, code, display_name, legal_name, social_name, doc, doc_digits, rg, rg_issuer, birth_date, profession, marital_status, notes, status, is_active, created_at, updated_at",
      { count: "exact" },
    )
    .order("updated_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

  if (ids) q = q.in("id", ids);
  if (kind && kind !== "todos") q = q.eq("kind", kind);
  if (status && status !== "todos") q = q.eq("status", status);

  const termo = search.trim();
  if (termo.length >= 2) {
    const d = onlyDigits(termo);
    const partes = [
      `display_name.ilike.%${termo}%`,
      `legal_name.ilike.%${termo}%`,
      `social_name.ilike.%${termo}%`,
      `code.ilike.%${termo}%`,
    ];
    if (d) partes.push(`doc_digits.ilike.%${d}%`);
    q = q.or(partes.join(","));
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Party[], total: count ?? 0 };
}

export async function getParty(id: string) {
  const [party, contatos, enderecos, papeis, consultora, vinculos] = await Promise.all([
    supabase.from("parties").select("*").eq("id", id).maybeSingle(),
    supabase.from("contact_points").select("*").eq("party_id", id).order("is_primary", { ascending: false }),
    supabase.from("party_addresses").select("*").eq("party_id", id),
    supabase.from("party_roles").select("*").eq("party_id", id),
    supabase.from("consultant_profiles").select("*").eq("party_id", id).maybeSingle(),
    supabase.from("party_links").select("*").eq("party_id", id),
  ]);
  if (party.error) throw party.error;
  if (!party.data) throw new Error("Cadastro não encontrado.");
  return {
    party: party.data as unknown as Party,
    contatos: (contatos.data ?? []) as unknown as ContactPoint[],
    enderecos: (enderecos.data ?? []) as unknown as PartyAddress[],
    papeis: (papeis.data ?? []) as unknown as PartyRoleRow[],
    consultora: (consultora.data ?? null) as unknown as ConsultantProfile | null,
    vinculos: (vinculos.data ?? []) as { entity_type: string; entity_id: string }[],
  };
}

export type PartyDraft = Partial<Omit<Party, "id" | "code" | "created_at" | "updated_at" | "doc_digits">>;

/** Cria ou atualiza a identidade canônica. Rascunho salva sem exigir nada. */
export async function saveParty(draft: PartyDraft, id?: string) {
  if (id) {
    const { data, error } = await supabase.from("parties").update(draft).eq("id", id).select("id").single();
    if (error) throw error;
    return data.id as string;
  }
  const { data, error } = await supabase
    .from("parties")
    .insert({ kind: draft.kind ?? "pessoa", ...draft })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function addRole(partyId: string, role: PartyRoleKind) {
  const { error } = await supabase.from("party_roles").insert({ party_id: partyId, role });
  if (error && !error.message.includes("duplicate")) throw error;
  if (role === "consultora") {
    await supabase.from("consultant_profiles").upsert({ party_id: partyId }, { onConflict: "party_id" });
  }
}

export async function removeRole(roleId: string) {
  const { error } = await supabase.from("party_roles").delete().eq("id", roleId);
  if (error) throw error;
}

export async function saveContact(partyId: string, c: Partial<ContactPoint> & { kind: ContactPoint["kind"]; value: string }) {
  const { error } = c.id
    ? await supabase.from("contact_points").update({ kind: c.kind, value: c.value, label: c.label ?? null }).eq("id", c.id)
    : await supabase.from("contact_points").insert({ party_id: partyId, kind: c.kind, value: c.value, label: c.label ?? null });
  if (error) throw error;
}

export async function removeContact(id: string) {
  const { error } = await supabase.from("contact_points").delete().eq("id", id);
  if (error) throw error;
}

export async function saveAddress(partyId: string, a: Partial<PartyAddress>) {
  const payload = {
    label: a.label ?? "Principal",
    postal_code: a.postal_code ?? null,
    street: a.street ?? null,
    street_number: a.street_number ?? null,
    no_number: a.no_number ?? false,
    complement: a.complement ?? null,
    district: a.district ?? null,
    city: a.city ?? null,
    uf: a.uf ?? null,
    reference: a.reference ?? null,
  };
  const { error } = a.id
    ? await supabase.from("party_addresses").update(payload).eq("id", a.id)
    : await supabase.from("party_addresses").insert({ party_id: partyId, is_primary: true, ...payload });
  if (error) throw error;
}

export async function saveConsultant(partyId: string, p: Partial<ConsultantProfile>) {
  const { error } = await supabase
    .from("consultant_profiles")
    .upsert({ party_id: partyId, ...p }, { onConflict: "party_id" });
  if (error) throw error;
}

/** Converte candidatura em consultora. Transacional e idempotente no banco. */
export async function convertLeadToConsultant(leadId: string, partyId?: string) {
  const { data, error } = await supabase.rpc("convert_lead_to_consultant", {
    _lead_id: leadId,
    ...(partyId ? { _party_id: partyId } : {}),
  });
  if (error) throw error;
  return data as string;
}

/** Possíveis pessoas iguais, por documento ou contato. Nunca funde sozinho. */
export async function findPossibleDuplicates(input: {
  doc?: string | null;
  contact?: string | null;
  ignoreId?: string;
}) {
  const encontrados = new Map<string, Party>();

  const d = onlyDigits(input.doc);
  if (d.length >= 11) {
    const { data } = await supabase.from("parties").select("*").eq("doc_digits", d).limit(10);
    for (const p of (data ?? []) as unknown as Party[]) encontrados.set(p.id, p);
  }

  const c = input.contact?.trim();
  if (c && c.length >= 5) {
    const norm = c.includes("@") ? c.toLowerCase() : onlyDigits(c);
    const { data } = await supabase.from("contact_points").select("party_id").eq("value_norm", norm).limit(10);
    const ids = (data ?? []).map((r) => r.party_id).filter((id) => id !== input.ideNull);
    if (ids.length) {
      const { data: ps } = await supabase.from("parties").select("*").in("id", ids);
      for (const p of (ps ?? []) as unknown as Party[]) encontrados.set(p.id, p);
    }
  }

  if (input.ignoreId) encontrados.delete(input.ignoreId);
  return [...encontrados.values()];
}

/** Percentual de completude honesto: só conta o que realmente existe. */
export function completude(p: {
  party: Party;
  contatos: ContactPoint[];
  enderecos: PartyAddress[];
}): { pct: number; faltando: string[] } {
  const checks: [string, boolean][] = [
    ["Nome", Boolean(p.party.display_name?.trim())],
    ["Documento (CPF/CNPJ)", Boolean(p.party.doc_digits)],
    ["Contato", p.contatos.length > 0],
    ["Endereço", p.enderecos.length > 0],
    ["Situação definida", p.party.status !== "rascunho"],
  ];
  const ok = checks.filter(([, v]) => v).length;
  return {
    pct: Math.round((ok / checks.length) * 100),
    faltando: checks.filter(([, v]) => !v).map(([k]) => k),
  };
}

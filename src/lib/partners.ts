import { supabase } from "@/integrations/supabase/client";

/** Fornecedores e entidades de negócio: leitura e gravação sempre pelo servidor. */
export type PartnerKind = "fornecedor" | "entidade";

export interface PartnerRow {
  id: string;
  nome: string;
  fantasia: string | null;
  doc_mascarado: string | null;
  tem_doc: boolean;
  inscricao_estadual?: string | null;
  contato?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade: string | null;
  uf: string | null;
  notas: string | null;
  ativo: boolean;
}

export interface PartnerPage {
  rows: PartnerRow[];
  total: number;
  /** O documento completo só pode ser revelado por quem tem a permissão. */
  pode_revelar: boolean;
  pode_gerir: boolean;
}

export async function listPartners(params: {
  kind: PartnerKind;
  search: string;
  page: number;
  pageSize: number;
}): Promise<PartnerPage> {
  const { data, error } = await supabase.rpc("partners_list", {
    _kind: params.kind,
    _search: params.search.trim() || undefined,
    _page: params.page,
    _size: params.pageSize,
  });
  if (error) throw error;
  const payload = (data ?? {}) as Partial<PartnerPage>;
  return {
    rows: payload.rows ?? [],
    total: payload.total ?? 0,
    pode_revelar: payload.pode_revelar ?? false,
    pode_gerir: payload.pode_gerir ?? false,
  };
}

/** Revela o documento completo. Cada revelação fica registrada na auditoria. */
export async function revealPartnerDoc(kind: PartnerKind, id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("partner_doc_reveal", { _kind: kind, _id: id });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export interface PartnerDraft {
  nome: string;
  fantasia?: string | null;
  /** Só enviar quando o usuário pode ver e alterar documentos. */
  doc?: string | null;
  inscricao_estadual?: string | null;
  contato?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  uf?: string | null;
  notas?: string | null;
  ativo?: boolean;
}

export async function savePartner(
  kind: PartnerKind,
  draft: PartnerDraft,
  id?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc("partner_save", {
    _kind: kind,
    ...(id ? { _id: id } : {}),
    _values: draft as unknown as never,
  });
  if (error) throw error;
  return data as string;
}

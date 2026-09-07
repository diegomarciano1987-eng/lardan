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
  const args: Record<string, unknown> = {
    _kind: params.kind,
    _page: params.page,
    _size: params.pageSize,
  };
  if (params.search.trim()) args["_search"] = params.search.trim();
  const { data, error } = await supabase.rpc("partners_list", args as never);
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
  const { data, error } = await supabase.rpc("partner_doc_reveal", { _kind: kind, _id: id } as never);
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
  const args: Record<string, unknown> = { _kind: kind, _values: draft, _id: id ?? null };

  const { data, error } = await supabase.rpc("partner_save", args as never);
  if (error) throw error;
  return data as string;
}

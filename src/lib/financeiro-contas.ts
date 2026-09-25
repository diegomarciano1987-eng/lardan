import { supabase } from "@/integrations/supabase/client";

async function rpc(f: string, a: Record<string, unknown>) {
  return (await supabase.rpc(f as never, a as never)) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
}

export interface MovimentoConta {
  id: string;
  data: string;
  kind: string;
  valor_cents: number;
  descricao: string | null;
  settlement_id: string | null;
  transfer_id: string | null;
  contraparte_conta: string | null;
  pessoas: string | null;
  titulos: { id: string; numero: string | null; descricao: string; direction: string }[] | null;
  autor: string | null;
  created_at: string;
}

export interface CockpitConta {
  saldo_anterior_cents: number;
  saldo_final_cents: number;
  entradas_cents: number;
  saidas_cents: number;
  transf_entrada_cents: number;
  transf_saida_cents: number;
  total: number;
  linhas: MovimentoConta[];
}

export interface AuditoriaConta {
  quando: string;
  acao: string;
  detalhe: Record<string, unknown> | null;
  autor: string | null;
}

export async function fetchCockpitConta(p: {
  id: string;
  de: string;
  ate: string;
  q?: string;
  limit: number;
  offset: number;
}): Promise<CockpitConta> {
  const { data, error } = await rpc("fin_account_cockpit", {
    _account: p.id,
    _de: p.de,
    _ate: p.ate,
    _q: p.q ?? null,
    _limit: p.limit,
    _offset: p.offset,
  });
  if (error) throw new Error(error.message);
  return data as CockpitConta;
}

export async function fetchAuditoriaConta(id: string): Promise<AuditoriaConta[]> {
  const { data, error } = await rpc("fin_account_auditoria", { _account: id });
  if (error) throw new Error(error.message);
  return (data as AuditoriaConta[]) ?? [];
}

export async function fetchDadosConta(id: string): Promise<Record<string, string | boolean | null>> {
  const { data, error } = await supabase
    .from("financial_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? {}) as unknown as Record<string, string | boolean | null>;
}

export async function atualizarConta(id: string, payload: Record<string, unknown>) {
  const { error } = await rpc("fin_account_update", { _account: id, _payload: payload });
  if (error) throw new Error(error.message);
}

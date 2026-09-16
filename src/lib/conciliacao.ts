import { supabase } from "@/integrations/supabase/client";

export type StatusLinha =
  | "pendente"
  | "invalida"
  | "repetida"
  | "parcial"
  | "conciliada"
  | "ignorada"
  | "divergente";

export const STATUS_LINHA_LABEL: Record<StatusLinha, string> = {
  pendente: "Pendente",
  invalida: "Inválida",
  repetida: "Repetida",
  parcial: "Parcialmente conciliada",
  conciliada: "Conciliada",
  ignorada: "Ignorada",
  divergente: "Divergente",
};

export type LinhaExtratoRow = {
  id: string;
  import_id: string;
  line_no: number;
  data: string | null;
  valor_cents: number | null;
  conciliado_cents: number;
  kind: string | null;
  historico: string | null;
  documento: string | null;
  bank_id: string | null;
  status: StatusLinha;
  error_reason: string | null;
  flag_reason: string | null;
  raw: Record<string, unknown>;
};

export type ResumoExtrato = {
  entradas_cents: number;
  saidas_cents: number;
  pendentes: number;
  conciliadas: number;
  parciais: number;
  divergentes: number;
  ignoradas: number;
  invalidas: number;
  repetidas: number;
  total: number;
};

export type Sugestao = {
  installment_id: string;
  score: number;
  reasons: { valor_exato: boolean; dias: number; documento: string; contraparte: string };
  vencimento: string;
  valor_cents: number;
  aberto_cents: number;
  titulo: string;
  contraparte: string | null;
};

const desembrulhar = <T,>(r: { data: unknown; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};

export async function listarLinhasExtrato(filtros: {
  financial_account_id?: string;
  status?: string;
  import_id?: string;
  de?: string;
  ate?: string;
  q?: string;
  limit: number;
  offset: number;
}) {
  return desembrulhar<{ rows: LinhaExtratoRow[]; total: number }>(
    await supabase.rpc("fin_statement_lines_list", { _filtros: filtros }),
  );
}

export async function resumoExtrato(filtros: {
  financial_account_id?: string;
  de?: string;
  ate?: string;
}) {
  return desembrulhar<ResumoExtrato>(
    await supabase.rpc("fin_statement_overview", { _filtros: filtros }),
  );
}

export async function sugerirCorrespondencias(lineId: string) {
  return desembrulhar<Sugestao[]>(await supabase.rpc("fin_statement_suggest", { _line: lineId }));
}

export async function conciliar(payload: {
  line_ids: string[];
  alocacoes: { installment_id: string; valor_cents: number }[];
  tarifa_cents?: number;
  juros_cents?: number;
  desconto_cents?: number;
  permitir_excedente?: boolean;
  observacao?: string;
  idempotency_key: string;
}) {
  return desembrulhar<{ id: string; settlement_id: string; repetido: boolean }>(
    await supabase.rpc("fin_reconcile", { _payload: payload }),
  );
}

export async function desfazerConciliacao(id: string, motivo: string) {
  return desembrulhar<string>(
    await supabase.rpc("fin_reconcile_undo", { _reconciliation: id, _motivo: motivo }),
  );
}

export async function marcarLinha(lineId: string, status: string, motivo: string) {
  return desembrulhar<null>(
    await supabase.rpc("fin_statement_line_flag", { _line: lineId, _status: status, _motivo: motivo }),
  );
}

export async function conciliacoesDaLinha(lineId: string) {
  const { data, error } = await supabase
    .from("financial_reconciliation_allocations")
    .select("valor_cents, reconciliation_id, financial_reconciliations(id, status, created_at, motivo)")
    .eq("line_id", lineId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Envia o arquivo ao armazenamento privado; a leitura e o hash acontecem no servidor. */
export async function enviarArquivoExtrato(contaId: string, arquivo: File) {
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const caminho = `${contaId}/${carimbo}-${arquivo.name.replace(/[^\w.-]/g, "_")}`;
  const { error } = await supabase.storage.from("extratos-bancarios").upload(caminho, arquivo, {
    contentType: arquivo.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return caminho;
}

import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(f: string, a: Record<string, unknown> = {}): Promise<T> {
  const r = (await supabase.rpc(f as never, a as never)) as unknown as { data: unknown; error: { message: string } | null };
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export type AcaoAuto = "baixa_titulo" | "baixa_com_juros" | "titulo_3_1_1" | "vinculo_ja_baixado" | "lancado_pela_mesa" | "excecao";

export const ROTULO_ACAO: Record<AcaoAuto, string> = {
  baixa_titulo: "Baixou conta em aberto",
  baixa_com_juros: "Baixou com juros",
  titulo_3_1_1: "Título 3.1.1 criado e baixado",
  vinculo_ja_baixado: "Ligado a baixa já existente",
  lancado_pela_mesa: "Lançado pela Mesa",
  excecao: "Exceção (decisão manual)",
};

export type ItemAuto = {
  id: string;
  acao: AcaoAuto;
  motivo: string;
  valor_cents: number | null;
  juros_cents: number;
  quando: string;
  desfeito_em: string | null;
  desfeito_motivo: string | null;
  pay: string;
  payment_date: string | null;
  billing_type: string | null;
  pessoa: string | null;
  pessoa_codigo: string | null;
  titulo_numero: string | null;
};

export type RelatorioAuto = {
  config: { ligado: boolean; corte: string; juros_max_cents: number; juros_max_pct: number } | null;
  resumo: { acao: AcaoAuto; qtd: number; valor_cents: number; juros_cents: number }[];
  excecoes_abertas: number;
  itens: ItemAuto[];
};

export const relatorioAuto = (de: string, ate: string) => rpc<RelatorioAuto>("asaas_auto_relatorio", { _de: de, _ate: ate });

export const desfazerAuto = (decisao: string, motivo: string) =>
  rpc<{ ok: boolean; estornos: number; titulo_cancelado: boolean }>("asaas_auto_desfazer", { _decisao: decisao, _motivo: motivo });

/** "Não, é novo" numa linha com pay_: o lançamento nasce preso à cobrança do Asaas (um pay_ = um lançamento). */
export const lancarPelaCobrancaAsaas = (
  line_id: string,
  payload: {
    party_id: string;
    descricao?: string;
    competencia?: string;
    documento?: string;
    observacao?: string;
    cost_center_id?: string;
    chart_account_id?: string;
    payment_method_id?: string;
  },
) => rpc<{ acao: string; title_id: string; linha: string }>("asaas_extrato_lancar", { _line: line_id, _payload: payload });

/** Pagamento de cobrança Asaas na linha do extrato (pay_…), quando houver. */
export const payDaLinha = (linha: { kind: string | null; raw: Record<string, unknown> | null }) => {
  const p = String(linha.raw?.["paymentId"] ?? "");
  return linha.kind === "entrada" && /^pay_/.test(p) && String(linha.raw?.["type"] ?? "PAYMENT_RECEIVED") === "PAYMENT_RECEIVED" ? p : null;
};

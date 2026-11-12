import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(f: string, a: Record<string, unknown> = {}): Promise<T> {
  const r = (await supabase.rpc(f as never, a as never)) as unknown as { data: unknown; error: { message: string } | null };
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export type AcaoAuto =
  | "baixa_titulo" | "baixa_com_juros" | "titulo_3_1_1" | "vinculo_ja_baixado" | "lancado_pela_mesa" | "excecao"
  | "adiantamento_maleta" | "titulo_judicial";

export const ROTULO_ACAO: Record<AcaoAuto, string> = {
  baixa_titulo: "Baixou conta em aberto",
  baixa_com_juros: "Baixou com juros",
  titulo_3_1_1: "Título 3.1.1 criado e baixado",
  vinculo_ja_baixado: "Ligado a baixa já existente",
  lancado_pela_mesa: "Lançado pela Mesa",
  excecao: "Exceção (decisão manual)",
  adiantamento_maleta: "Pix da consultora com maleta aberta (3.1.1, abate no acerto)",
  titulo_judicial: "TED judicial (7.1.7, Administrativo)",
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

/** 0286 — etapa B: o que o Asaas conferiu sozinho no extrato. */
export type TipoExtratoAuto = "identificacao" | "tarifa" | "notificacoes" | "transferencia" | "negativacao" | "fatura_baixa" | "antecipacao_par";

export const ROTULO_TIPO_EXTRATO: Record<TipoExtratoAuto, string> = {
  identificacao: "Título da planilha identificado",
  tarifa: "Tarifa Pix (5.1.3) e boleto (4.1.2)",
  notificacoes: "Notificações do mês (5.1.1)",
  negativacao: "Negativação Serasa/SPC do mês (4.1.5)",
  fatura_baixa: "Ligada à baixa já importada (mesma fatura)",
  antecipacao_par: "Cartão antecipado: recebimento e baixa da antecipação (sem lançamento)",
  transferencia: "Transferência para o banco conferida",
};

export type ItemExtratoAuto = {
  id: string;
  tipo: TipoExtratoAuto;
  motivo: string;
  valor_cents: number | null;
  quando: string;
  desfeito_em: string | null;
  desfeito_motivo: string | null;
  detalhe: Record<string, unknown> | null;
  pay: string | null;
  pessoa: string | null;
  pessoa_codigo: string | null;
  titulo_numero: string | null;
};

export type RelatorioExtratoAuto = {
  ligado: boolean | null;
  resumo: { tipo: TipoExtratoAuto; qtd: number; valor_cents: number }[];
  itens: ItemExtratoAuto[];
};

export const relatorioExtratoAuto = (de: string, ate: string) =>
  rpc<RelatorioExtratoAuto>("asaas_auto_extrato_relatorio", { _de: de, _ate: ate });

export const desfazerExtratoAuto = (id: string, motivo: string) =>
  rpc<{ ok: boolean; tipo: TipoExtratoAuto }>("asaas_auto_extrato_desfazer", { _id: id, _motivo: motivo });

/** 0297 — pente fino Asaas × Lardan: alertas de cobrança excluída/alterada e comparação por pessoa. */
export type AlertaAsaas = {
  id: string;
  tipo: "cobranca_excluida" | "valor_alterado" | "vencimento_alterado";
  criado_em: string;
  antes: { valor_cents?: number; vencimento?: string; status?: string };
  depois: { valor_cents?: number; vencimento?: string; status?: string };
  saldo_cents: number | null;
  installment_id: string | null;
  pay: string;
  titulo_numero: string | null;
  pessoa: string | null;
  pessoa_codigo: string | null;
  judicial: boolean;
};
export type CategoriaPente = "igual" | "so_asaas" | "so_lardan" | "lardan_maior" | "asaas_maior" | "mesmo_total";
export const ROTULO_CATEGORIA: Record<CategoriaPente, string> = {
  igual: "Iguais",
  so_asaas: "Só no Asaas",
  so_lardan: "Só no Lardan",
  lardan_maior: "Lardan maior",
  asaas_maior: "Asaas maior",
  mesmo_total: "Mesmo total, montado diferente",
};
export type PenteFino = {
  gerado_em: string;
  resumo: { categoria: CategoriaPente; pessoas: number; lardan_cents: number; asaas_cents: number }[];
  pessoas: {
    codigo: string | null; nome: string; categoria: CategoriaPente; lardan_cents: number; asaas_cents: number;
    asaas_sem_parcela_cents: number; lardan_sem_cobranca_cents: number; fantasma_cents: number;
  }[];
  alertas: AlertaAsaas[];
  fantasmas: { id: string; criado_em: string; saldo_cents: number; motivo: string; desfeito_em: string | null; titulo_numero: string; pessoa: string | null; pessoa_codigo: string | null }[];
};
export const penteFino = () => rpc<PenteFino>("asaas_pente_fino", { _limite: 300 });
export const cancelarFantasma = (inst: string, motivo: string) =>
  rpc<{ ok: boolean; numero: string; saldo_cents: number }>("asaas_fantasma_cancelar", { _inst: inst, _motivo: motivo });
export const desfazerFantasma = (id: string, motivo: string) => rpc<{ ok: boolean }>("asaas_fantasma_desfazer", { _id: id, _motivo: motivo });
export const resolverAlerta = (id: string, resolucao: string) => rpc<{ ok: boolean }>("asaas_alerta_resolver", { _id: id, _resolucao: resolucao });

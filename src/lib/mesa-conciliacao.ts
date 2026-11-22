import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(f: string, a: Record<string, unknown> = {}): Promise<T> {
  const r = (await supabase.rpc(f as never, a as never)) as unknown as {
    data: unknown;
    error: { message: string } | null;
  };
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export const PAPEL_LABEL: Record<string, string> = {
  consultora: "Consultora",
  revendedora: "Revendedora",
  representante: "Representante",
  fornecedor: "Fornecedor",
  cliente: "Cliente",
  colaborador: "Colaborador",
  candidata: "Candidata",
  transportadora: "Transportadora",
  prestador: "Prestador",
  custodiante: "Custodiante",
  entidade_grupo: "Empresa do grupo",
  usuario: "Usuário",
  loja: "Loja",
};

export const papeisTexto = (p: string[] | null | undefined) =>
  (p ?? []).map((x) => PAPEL_LABEL[x] ?? x).join(" · ");

export type Palpite = {
  chave: string | null;
  vezes: number;
  party_id?: string | null;
  party_nome?: string | null;
  cost_center_id?: string | null;
  chart_account_id?: string | null;
  payment_method_id?: string | null;
  /** Recebimento judicial (alvará/TED de recurso judicial): sugere 7.1.7; nunca concilia sozinho. */
  judicial?: {
    /** 0293: TED judicial vai para o centro Administrativo. */
    cost_center_id?: string | null;
    chart_account_id: string | null;
    party_id: string | null;
    party_nome: string | null;
    processo: string | null;
    motivo: "numero_processo" | "palavra_judicial";
  } | null;
};

export type ContraparteMesa = { id: string; nome: string; code: string; papeis: string[] };
export type CentroMesa = {
  id: string;
  codigo: string;
  nome: string;
  responsavel_party_id: string | null;
  responsavel_nome: string | null;
  papeis: string[];
};
export type TituloDaParcela = {
  title_id: string;
  updated_at: string;
  cost_center_id: string | null;
  chart_account_id: string | null;
  payment_method_id: string | null;
  party_id: string | null;
  business_entity_id: string | null;
  financial_account_id: string | null;
};

/** Classificação aprendida com conciliações anteriores do mesmo tipo de histórico. */
export const palpiteDaLinha = (line: string) => rpc<Palpite>("fin_mesa_palpite", { _line: line });
export const contrapartesMesa = (busca: string) =>
  rpc<ContraparteMesa[]>("fin_mesa_contrapartes", { _busca: busca || null });
export const centrosMesa = () => rpc<CentroMesa[]>("fin_mesa_centros");
export const tituloDaParcela = (inst: string) =>
  rpc<TituloDaParcela>("fin_mesa_titulo_da_parcela", { _inst: inst });

/**
 * 0368: Pix com CPF/CNPJ no histórico (OFX Santander) → a pessoa (só com UM cadastro) e a distribuição
 * do valor pelas dívidas em aberto, da mais antiga para a mais nova (baixa parcial na última). Só leitura.
 */
export type PlanoDocumento = {
  situacao: "nao_se_aplica" | "sem_documento" | "sem_cadastro" | "varios_cadastros" | "sem_aberto" | "ok";
  tipo?: "cpf" | "cnpj";
  documento?: string;
  party_id?: string;
  party_nome?: string;
  party_code?: string | null;
  judicial?: boolean;
  cadastros?: { id: string; nome: string; code: string | null }[];
  valor_linha_cents?: number;
  total_aberto_cents?: number;
  distribuido_cents?: number;
  sobra_cents?: number;
  parcelas?: { installment_id: string; vencimento: string; titulo: string; titulo_numero: string | null; aberto_cents: number; aloc_cents: number; em_acordo: boolean; parcial: boolean }[];
};
export const planoPorDocumento = (line: string) => rpc<PlanoDocumento>("fin_mesa_por_documento", { _line: line });

/** Novo lançamento + conciliação numa só transação no banco (sem título órfão, repetível). */
export const novoLancamentoConciliar = (payload: {
  line_id: string;
  party_id: string;
  descricao: string;
  competencia?: string;
  documento?: string;
  observacao?: string;
  cost_center_id?: string;
  chart_account_id?: string;
  payment_method_id?: string;
  tarifa_cents?: number;
}) => rpc<{ id: string; title_id: string; repetido: boolean }>("fin_mesa_novo_conciliar", { _payload: payload });

/**
 * Mesma conta do banco: recebimento → linha = alocado − tarifa;
 * pagamento → linha = alocado + tarifa. Juros e desconto mudam o saldo da parcela, não a linha.
 */
export const faltaConciliar = (valorLinha: number, somaAloc: number, tarifa: number, saida: boolean) =>
  saida ? valorLinha - somaAloc - tarifa : valorLinha - somaAloc + tarifa;

/** Microtarifas de notificação do Asaas (WhatsApp R$ 0,45 e robô de voz R$ 0,55). */
export type MicrotarifaMes = {
  mes: string; qtd: number; qtd_whatsapp: number; qtd_voz: number; total_cents: number; de: string; ate: string;
};
export const microtarifasPrevia = (conta: string, ate?: string) =>
  rpc<MicrotarifaMes[]>("fin_microtarifas_previa", { _conta: conta, _ate: ate ?? null });
export const microtarifasConciliar = (conta: string, ate?: string) =>
  rpc<{ meses: { mes: string; title_id: string; linhas: number; total_cents: number }[] }>(
    "fin_microtarifas_conciliar", { _conta: conta, _ate: ate ?? null });
/** Reconhece a linha pelo histórico do Asaas (a lista não traz o tipo bruto). */
export const ehMicrotarifa = (historico: string | null | undefined) =>
  /^Taxa de notificação por (WhatsApp|robô de voz)/i.test(historico ?? "");

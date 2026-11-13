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

/** 0299 — baixa no Lardan espelhada no Asaas: cobrança antiga cancelada e, havendo saldo, nova pelo saldo. */
export type TarefaSaldo = {
  id: string;
  acao: "cancelar" | "substituir" | "reabrir" | "alterar" | "excecao";
  motivo: string;
  estado: "pendente" | "processando" | "concluida" | "excecao" | "falhou" | "ignorada";
  saldo_cents: number;
  aberto_cents: number;
  cobrancas: { external_id: string; valor_cents: number; vencimento: string; resultado: string | null }[];
  novo_valor_cents: number | null;
  novo_vencimento: string | null;
  erro: string | null;
  decisao_motivo: string | null;
  created_at: string;
  concluida_em: string | null;
  tentativas: number;
  titulo_numero: string;
  pessoa: string | null;
  pessoa_codigo: string | null;
  nova_external_id: string | null;
  nova_invoice_url: string | null;
};
export type PainelSaldo = {
  resumo: { concluidas: number; canceladas_cents: number; novas: number; novas_cents: number; excecoes: number; andamento: number };
  tarefas: TarefaSaldo[];
};
export const ROTULO_MOTIVO_SALDO: Record<string, string> = {
  baixa_parcial: "Baixa parcial no Lardan",
  baixa_parcial_sem_reemissao: "Baixa parcial: a antiga foi cancelada no Asaas; gere a nova pela tela",
  quitada: "Quitada no Lardan",
  titulo_cancelado: "Título cancelado no Lardan",
  estorno: "Baixa estornada no Lardan",
  saldo_abaixo_minimo: "Saldo abaixo de R$ 5,00 (cobrar por fora)",
  varias_cobrancas: "Várias cobranças na mesma parcela",
  cliente_judicial: "Cliente com processo judicial",
  parcela_em_acordo: "Parcela dentro de acordo",
  cliente_sem_vinculo: "Cliente sem cadastro no Asaas",
  cliente_duplicado: "Cliente com dois cadastros no Asaas",
  conta_asaas: "Conta Asaas da empresa indefinida",
  titulo_nao_aprovado: "Título ainda não aprovado",
  pago_no_asaas: "Já paga no Asaas (conferir pagamento em dobro)",
  nova_cobranca_recusada: "Antiga cancelada; nova não foi criada",
  cobranca_viva_encontrada: "Outra cobrança aberta encontrada",
  vencimento_alterado: "Vencimento mudado no Lardan",
  valor_alterado: "Valor mudado no Lardan",
  vencimento_no_passado: "Vencimento do Lardan já passou (o Asaas não aceita data passada)",
  excluida_no_asaas: "Excluída direto no Asaas (não reemitida sozinha)",
};
export const painelSaldo = () => rpc<PainelSaldo>("asaas_saldo_painel", { _limite: 150 });

/** 0303 — diferenças AGORA entre a parcela do Lardan e a cobrança aberta no Asaas. */
export type DiferencaEspelho = {
  charge_id: string;
  external_id: string;
  external_status: string;
  invoice_url: string | null;
  asaas_vencimento: string;
  asaas_valor_cents: number;
  installment_id: string;
  lardan_vencimento: string;
  parcela_valor_cents: number;
  lardan_saldo_cents: number;
  title_id: string;
  titulo_numero: string;
  pessoa: string | null;
  pessoa_codigo: string | null;
  valor_diferente: boolean;
  vencimento_diferente: boolean;
  pode_levar: boolean;
  tarefa_estado: string | null;
  tarefa_motivo: string | null;
  pedido_aberto: boolean;
};
export const diferencasEspelho = () => rpc<DiferencaEspelho[]>("asaas_espelho_diferencas", { _limite: 300 });

/* ---------------------------------------------------------------- 0312: vários cadastros no Asaas */
export type CadastroAsaas = {
  customer_id: string;
  external_id: string;
  principal: boolean;
  situacao: "vinculado" | "pendente";
  espelho: string | null;
  conferido_em: string | null;
  criado: string | null;
  abertas: number;
  aberto_cents: number;
};
export type ClienteVariosCadastros = {
  party_id: string;
  pessoa: string;
  codigo: string | null;
  pendentes: number;
  iguais: number;
  principal: string | null;
  cadastros: CadastroAsaas[];
};
export const clientesVariosCadastros = () => rpc<ClienteVariosCadastros[]>("asaas_clientes_varios_cadastros");
export const trocarCadastroPrincipal = (customerId: string, motivo: string) =>
  rpc<{ ok: boolean; de: string | null; para: string }>("asaas_cliente_principal_trocar", { _customer: customerId, _motivo: motivo });

/**
 * Contrato do adaptador Asaas.
 *
 * O resto do sistema só conhece esta interface. O transporte (simulado agora,
 * HTTP no futuro) é substituível e é escolhido pelo SERVIDOR — o navegador não
 * escolhe transporte, ambiente nem endereço.
 */

/** @deprecated use ModoExecucao + AmbienteProvedor */
export type Ambiente = "simulacao" | "sandbox" | "producao";

/** Como o servidor executa: simulador local ou provedor de verdade. */
export type ModoExecucao = "simulado" | "conectado";
/** Qual ambiente do provedor, só quando conectado. */
export type AmbienteProvedor = "sandbox" | "producao";

export type FormaPagamento = "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";

export interface ClienteExterno {
  id: string;
  name: string;
  cpfCnpj?: string | null;
  email?: string | null;
}

export interface CobrancaExterna {
  id: string;
  customer: string;
  customerName?: string | null;
  /** valores sempre em centavos no nosso contrato; o transporte converte */
  valueCents: number;
  netValueCents?: number | null;
  feeCents?: number | null;
  valuePaidCents?: number | null;
  refundedCents?: number | null;
  dueDate: string;
  paymentDate?: string | null;
  creditDate?: string | null;
  billingType: FormaPagamento;
  status: string;
  description?: string | null;
  externalReference?: string | null;
  dateCreated?: string | null;
  /** endereço da fatura devolvido pelo provedor — nunca montado por concatenação */
  invoiceUrl?: string | null;
}

export interface Pagina<T> {
  itens: T[];
  /** quantidade recebida antes de qualquer filtro local */
  quantidadeBruta: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  total?: number | null;
  /** próximo offset no provedor quando a página foi filtrada localmente */
  proximoOffset?: number;
}

export interface FiltroCobrancas {
  limit: number;
  offset: number;
  /** recorte por vencimento; débitos antigos em aberto entram por `somenteEmAberto` */
  dueDateGE?: string | null;
  dueDateLE?: string | null;
  /** traz também o que venceu antes do recorte e continua devido */
  incluirEmAbertoAnteriores?: boolean;
  customer?: string | null;
}

export interface NovaCobranca {
  customer: string;
  valueCents: number;
  dueDate: string;
  billingType: FormaPagamento;
  description?: string | null;
  /** correlação; sozinho NÃO garante unicidade no provedor */
  externalReference: string;
  /** chave de repetição do nosso lado */
  idempotencyKey: string;
}

export interface EventoExterno {
  id: string;
  event: string;
  chargeExternalId: string;
  eventAt: string;
  payload: Record<string, unknown>;
}

/** Falha de transporte cujo resultado no provedor é desconhecido. */
export class RespostaPerdida extends Error {
  constructor(msg = "Resposta não recebida do provedor") {
    super(msg);
    this.name = "RespostaPerdida";
  }
}

/** Falha explícita do provedor: a cobrança não existe lá. */
export class RecusadoPeloProvedor extends Error {
  constructor(
    msg: string,
    readonly status: number | null = null,
    readonly codigos: string[] = [],
  ) {
    super(msg);
    this.name = "RecusadoPeloProvedor";
  }
}

/** 429: o provedor não processou; pode tentar depois. */
export class LimiteDeRequisicoes extends RecusadoPeloProvedor {
  constructor(readonly repetirEmSegundos: number | null = null) {
    super("Limite de requisições do provedor atingido.", 429, ["rate_limit"]);
    this.name = "LimiteDeRequisicoes";
  }
}

/** 401/403: credencial ausente, inválida ou de outro ambiente. Nada foi criado. */
export class CredencialRecusada extends RecusadoPeloProvedor {
  constructor(status: number, codigos: string[]) {
    super("Credencial recusada pelo provedor (ausente, inválida ou de outro ambiente).", status, codigos);
    this.name = "CredencialRecusada";
  }
}

/** Nada saiu do servidor: seguro afirmar que o provedor não criou nada. */
export class FalhaAntesDoEnvio extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "FalhaAntesDoEnvio";
  }
}

/** Consulta (GET) falhou de forma transitória; não diz nada sobre existência. */
export class ConsultaIndisponivel extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ConsultaIndisponivel";
  }
}

/** Mais de um registro para uma referência que deveria ser única do nosso lado. */
export class ReferenciaAmbigua extends Error {
  constructor(ref: string, n: number) {
    super(`A referência ${ref} corresponde a ${n} registros no provedor: exige conciliação humana.`);
    this.name = "ReferenciaAmbigua";
  }
}

export interface TransporteAsaas {
  readonly ambiente: Ambiente;
  readonly simulado: boolean;
  readonly modo: ModoExecucao;

  listarClientes(f: { limit: number; offset: number }): Promise<Pagina<ClienteExterno>>;
  consultarCliente(id: string): Promise<ClienteExterno | null>;
  /** localiza o cliente já vinculado; nunca procura por nome */
  localizarClientePorReferencia(ref: string): Promise<ClienteExterno | null>;
  prepararCliente(dados: { name: string; cpfCnpj?: string | null; email?: string | null; ref: string }): Promise<ClienteExterno>;

  listarCobrancas(f: FiltroCobrancas): Promise<Pagina<CobrancaExterna>>;
  consultarCobranca(id: string): Promise<CobrancaExterna | null>;
  consultarCobrancaPorReferencia(ref: string): Promise<CobrancaExterna | null>;
  criarCobranca(n: NovaCobranca): Promise<CobrancaExterna>;

  /** endereço da fatura, como o provedor devolve */
  obterLinkFatura(chargeId: string): Promise<string>;

  /** fila local de eventos (no futuro, entregues pelo webhook) */
  receberEventos(): Promise<EventoExterno[]>;
}

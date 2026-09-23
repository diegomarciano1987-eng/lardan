/**
 * Contrato do adaptador Asaas.
 *
 * O resto do sistema só conhece esta interface. O transporte (simulado agora,
 * HTTP no futuro) é substituível e é escolhido pelo SERVIDOR — o navegador não
 * escolhe transporte, ambiente nem endereço.
 */

export type Ambiente = "simulacao" | "sandbox" | "producao";

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
  offset: number;
  limit: number;
  hasMore: boolean;
  total?: number | null;
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
  constructor(msg: string) {
    super(msg);
    this.name = "RecusadoPeloProvedor";
  }
}

export interface TransporteAsaas {
  readonly ambiente: Ambiente;
  readonly simulado: boolean;

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

/**
 * Serviço "Gerar link de cobrança".
 *
 * Uma cobrança individual por parcela, cliente conhecido, endereço da fatura
 * devolvido pelo provedor. Não usamos /paymentLinks: aquele produto tem outro
 * fluxo de criação de cliente e cobrança e fica fora desta rodada.
 *
 * Gerar link não liquida a parcela, não cria obrigação nova, não comprova venda
 * e não emite documento fiscal.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS } from "./banco";
import { RecusadoPeloProvedor, RespostaPerdida, type FormaPagamento, type TransporteAsaas } from "./contrato";

export interface PedidoCobranca {
  accountId: string;
  installmentId: string;
  billingType: FormaPagamento;
  dueDate?: string | null;
  idempotencyKey?: string | null;
  criarCliente?: boolean;
  worker?: string;
}

export interface Intencao {
  id?: string;
  repetida?: boolean;
  reaproveitada?: boolean;
  state?: string;
  valor_cents?: number;
  due_date?: string;
  billing_type?: FormaPagamento;
  customer_external_id?: string | null;
  criar_cliente?: boolean;
  internal_reference?: string;
  invoice_url?: string | null;
  external_id?: string | null;
  charge_id?: string | null;
  simulado?: boolean;
  aviso?: string;
}

export const prepararIntencao = (banco: BancoAsaas, p: PedidoCobranca) =>
  banco.rpc<Intencao>(ROTINAS.cobrancaPreparar, {
    _payload: {
      account_id: p.accountId,
      installment_id: p.installmentId,
      billing_type: p.billingType,
      due_date: p.dueDate ?? null,
      idempotency_key: p.idempotencyKey ?? null,
      criar_cliente: p.criarCliente ?? false,
    },
  });

export interface ResultadoCobranca {
  id?: string;
  state: string;
  invoice_url?: string | null;
  external_id?: string | null;
  charge_id?: string | null;
  simulado?: boolean;
  reaproveitada?: boolean;
  aviso?: string;
}

/**
 * Executa a intenção. A transação do banco é curta: reservamos, saímos do
 * banco, chamamos o adaptador e só então gravamos o resultado.
 */
export async function executarIntencao(
  banco: BancoAsaas,
  transporte: TransporteAsaas,
  intencaoId: string,
  dados: {
    customerExternalId?: string | null;
    valueCents: number;
    dueDate: string;
    billingType: FormaPagamento;
    internalReference: string;
    idempotencyKey: string;
    descricao?: string | null;
    devedor?: { nome: string; doc?: string | null; email?: string | null };
  },
  worker = "web",
): Promise<ResultadoCobranca> {
  const reserva = await banco.rpc<{ reservada: boolean; state: string; invoice_url?: string | null; external_id?: string | null }>(
    ROTINAS.cobrancaProcessando,
    { _intent: intencaoId, _worker: worker },
  );
  if (!reserva.reservada) {
    // duplo clique, segunda aba ou outro trabalhador: um único efeito
    return { id: intencaoId, state: reserva.state, invoice_url: reserva.invoice_url ?? null, external_id: reserva.external_id ?? null, reaproveitada: true };
  }

  let cliente = dados.customerExternalId ?? null;
  if (!cliente) {
    if (!dados.devedor) throw new Error("Sem cliente externo e sem dados para prepará-lo.");
    const criado = await transporte.prepararCliente({
      name: dados.devedor.nome,
      cpfCnpj: dados.devedor.doc ?? null,
      email: dados.devedor.email ?? null,
      ref: dados.internalReference,
    });
    cliente = criado.id;
  }

  try {
    const criada = await transporte.criarCobranca({
      customer: cliente,
      valueCents: dados.valueCents,
      dueDate: dados.dueDate,
      billingType: dados.billingType,
      description: dados.descricao ?? null,
      externalReference: dados.internalReference,
      idempotencyKey: dados.idempotencyKey,
    });
    const link = criada.invoiceUrl ?? (await transporte.obterLinkFatura(criada.id));
    return banco.rpc<ResultadoCobranca>(ROTINAS.cobrancaResultado, {
      _intent: intencaoId,
      _payload: { resultado: "criada", external_id: criada.id, invoice_url: link, status: criada.status, raw: {} },
    });
  } catch (e) {
    if (e instanceof RespostaPerdida) {
      // pode ter criado lá. NÃO reenviar: consultar antes.
      return banco.rpc<ResultadoCobranca>(ROTINAS.cobrancaResultado, {
        _intent: intencaoId,
        _payload: { resultado: "desconhecida", erro: e.message },
      });
    }
    if (e instanceof RecusadoPeloProvedor) {
      return banco.rpc<ResultadoCobranca>(ROTINAS.cobrancaResultado, {
        _intent: intencaoId,
        _payload: { resultado: "rejeitada", erro: e.message },
      });
    }
    throw e;
  }
}

/**
 * Resolve um resultado desconhecido: consulta o provedor pela referência
 * interna e aproveita a cobrança que já existir. Nunca cria uma segunda.
 */
export async function conciliarDesconhecida(
  banco: BancoAsaas,
  transporte: TransporteAsaas,
  intencao: { id: string; internal_reference: string },
): Promise<ResultadoCobranca> {
  const achada = await transporte.consultarCobrancaPorReferencia(intencao.internal_reference);
  if (!achada) {
    return { id: intencao.id, state: "desconhecida", aviso: "Nada encontrado no provedor. Reenvio exige decisão humana." };
  }
  const link = achada.invoiceUrl ?? (await transporte.obterLinkFatura(achada.id));
  return banco.rpc<ResultadoCobranca>(ROTINAS.cobrancaResultado, {
    _intent: intencao.id,
    _payload: { resultado: "criada", external_id: achada.id, invoice_url: link, status: achada.status, raw: {} },
  });
}

/** Percurso completo do botão "Gerar link de cobrança". */
export async function gerarLinkDeCobranca(
  banco: BancoAsaas,
  transporte: TransporteAsaas,
  p: PedidoCobranca & { descricao?: string | null; devedor?: { nome: string; doc?: string | null; email?: string | null } },
): Promise<ResultadoCobranca> {
  const intencao = await prepararIntencao(banco, p);
  if (intencao.reaproveitada) {
    return { state: "criada", invoice_url: intencao.invoice_url ?? null, external_id: intencao.external_id ?? null, charge_id: intencao.charge_id ?? null, reaproveitada: true, aviso: intencao.aviso ?? "" };
  }
  if (!intencao.id) throw new Error("Intenção não registrada.");
  if (intencao.state && intencao.state !== "preparada") {
    return { id: intencao.id, state: intencao.state, invoice_url: intencao.invoice_url ?? null, external_id: intencao.external_id ?? null, reaproveitada: true };
  }
  return executarIntencao(
    banco,
    transporte,
    intencao.id,
    {
      customerExternalId: intencao.customer_external_id ?? null,
      valueCents: intencao.valor_cents!,
      dueDate: intencao.due_date!,
      billingType: intencao.billing_type!,
      internalReference: intencao.internal_reference!,
      idempotencyKey: p.idempotencyKey ?? intencao.internal_reference!,
      descricao: p.descricao ?? null,
      devedor: p.devedor,
    },
    p.worker,
  );
}

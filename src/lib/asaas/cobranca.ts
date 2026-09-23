/**
 * Serviço "Gerar link de cobrança" — fatura individual por parcela.
 *
 * O usuário SOLICITA (banco do usuário: capacidade e saldo conferidos no
 * servidor). Quem executa e grava o que o provedor devolveu é o EXECUTOR
 * interno (banco de serviço), com posse temporária, tentativa e trabalhador
 * conferidos. O navegador não declara que o provedor criou, nem informa ID,
 * endereço ou situação.
 *
 * Gerar link não liquida a parcela, não cria obrigação nova, não comprova venda
 * e não emite documento fiscal.
 */
import type { BancoAsaas } from "./banco";
import { ROTINAS, ROTINAS_EXECUTOR } from "./banco";
import {
  FalhaAntesDoEnvio,
  CredencialRecusada,
  LimiteDeRequisicoes,
  ConsultaIndisponivel,
  ReferenciaAmbigua,
  RecusadoPeloProvedor,
  type FormaPagamento,
  type TransporteAsaas,
} from "./contrato";

export interface PedidoCobranca {
  /** legado aceito em chamadas internas/testes, mas deliberadamente ignorado */
  accountId?: string;
  installmentId: string;
  billingType: FormaPagamento;
  dueDate?: string | null;
  idempotencyKey?: string | null;
  criarCliente?: boolean;
}

export interface OpcoesExecutor {
  /** usuário em nome de quem o executor age; null = rotina agendada */
  actor: string | null;
  worker?: string;
  leaseSegundos?: number;
  /** relógio controlado (somente testes/rotina interna); padrão: agora do banco */
  agora?: string;
  /** conta que o preflight do servidor resolveu; a intenção precisa bater */
  contaEsperada?: string;
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
  account_id?: string;
}

export const prepararIntencao = (banco: BancoAsaas, p: PedidoCobranca) =>
  banco.rpc<Intencao>(ROTINAS.cobrancaPreparar, {
    _payload: {
      installment_id: p.installmentId,
      billing_type: p.billingType,
      due_date: p.dueDate ?? null,
      idempotency_key: p.idempotencyKey ?? null,
      criar_cliente: p.criarCliente ?? true,
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
  fase?: string | null;
  erro?: string | null;
  aviso?: string;
  failure_class?: string | null;
  next_attempt_at?: string | null;
  pendencia_operacional?: boolean;
}

interface Reserva {
  id: string;
  reservada: boolean;
  modo?: "criar" | "consultar";
  state: string;
  tentativa: number;
  worker: string;
  account_id: string;
  modo_execucao: "simulado" | "conectado";
  customer_external_id: string | null;
  party_id: string;
  devedor: { nome: string | null; doc: string | null };
  valor_cents: number;
  due_date: string;
  billing_type: FormaPagamento;
  internal_reference: string;
  external_id: string | null;
  invoice_url?: string | null;
  charge_id?: string | null;
}

interface ReservaCliente {
  reservada: boolean;
  ocupada?: boolean;
  token?: string;
  estado?: string;
  existente?: boolean;
  external_id?: string;
  revisao?: boolean;
  motivo?: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);
export const refCliente = (partyId: string) => `lardan:party:${partyId}`;

async function obterLinkSeguro(t: TransporteAsaas, id: string, dado?: string | null) {
  if (dado) return dado;
  try {
    return await t.obterLinkFatura(id);
  } catch {
    return null; // cobrança existe; o link é recuperado depois pelo ID, sem criar outra
  }
}

/**
 * Executa (ou retoma) uma intenção. Transações curtas: reserva, sai do banco,
 * fala com o adaptador, grava. Qualquer falha na gravação deixa a posse
 * vencer; a retomada consulta o provedor antes de qualquer reenvio.
 */
/** Mantém a posse viva durante uma chamada lenta ao provedor. */
async function comRenovacao<T>(fn: () => Promise<T>, renovar: () => Promise<unknown>, leaseSegundos: number): Promise<T> {
  const h = setInterval(() => void renovar().catch(() => undefined), Math.max(250, (leaseSegundos * 1000) / 3));
  try {
    return await fn();
  } finally {
    clearInterval(h);
  }
}

const opc = (o: OpcoesExecutor) => (o.agora ? { _agora: o.agora } : {});

/**
 * Executa (ou retoma) uma intenção. Transações curtas: reserva, sai do banco,
 * fala com o adaptador, grava. Qualquer falha na gravação deixa a posse
 * vencer; a retomada consulta o provedor antes de qualquer reenvio.
 * 401/403, 429 e consulta indisponível mantêm a MESMA intenção em
 * 'aguardando_retentativa' até next_attempt_at.
 */
export async function executarIntencao(
  servico: BancoAsaas,
  transporte: TransporteAsaas,
  intencaoId: string,
  o: OpcoesExecutor,
): Promise<ResultadoCobranca> {
  const worker = o.worker ?? `srv-${Math.random().toString(36).slice(2, 10)}`;
  const lease = o.leaseSegundos ?? 120;
  const r = await servico.rpc<Reserva & { failure_class?: string | null; next_attempt_at?: string | null }>(ROTINAS_EXECUTOR.reservar, {
    _intent: intencaoId,
    _worker: worker,
    _actor: o.actor,
    _lease_segundos: lease,
    _timeout_req: transporte.timeoutRequisicaoSegundos,
    ...opc(o),
  });
  if (!r.reservada) {
    // duplo clique, outra aba, outro trabalhador ou prazo de retentativa ainda aberto
    return {
      id: intencaoId, state: r.state, invoice_url: r.invoice_url ?? null, external_id: r.external_id ?? null,
      charge_id: r.charge_id ?? null, reaproveitada: true,
      failure_class: r.failure_class ?? null, next_attempt_at: r.next_attempt_at ?? null,
      ...(r.state === "aguardando_retentativa" ? { aviso: "Nova tentativa só depois do prazo registrado." } : {}),
    };
  }
  const base = { _intent: intencaoId, _worker: worker, _tentativa: r.tentativa, _actor: o.actor };
  const gravar = (payload: Record<string, unknown>) =>
    servico.rpc<ResultadoCobranca>(ROTINAS_EXECUTOR.resultado, { ...base, _payload: payload });
  const adiar = (classe: string, e: Error, repetirEm?: number | null, codigos: string[] = []) =>
    servico.rpc<ResultadoCobranca>(ROTINAS_EXECUTOR.adiar, {
      ...base, _classe: classe, _codigos: codigos, _repetir_em: repetirEm ?? null, _erro: msg(e), ...opc(o),
    });
  const revisar = (e: Error) => servico.rpc<ResultadoCobranca>(ROTINAS_EXECUTOR.revisao, { ...base, _motivo: msg(e) });
  const renovarIntencao = () =>
    servico.rpc(ROTINAS_EXECUTOR.renovar, { _intent: intencaoId, _worker: worker, _tentativa: r.tentativa, _segundos: lease });
  const recuperavel = (e: unknown) => {
    if (e instanceof CredencialRecusada) return adiar("credencial", e, null, e.codigos);
    if (e instanceof LimiteDeRequisicoes) return adiar("limite", e, e.repetirEmSegundos, e.codigos);
    if (e instanceof ConsultaIndisponivel) return adiar("consulta_indisponivel", e);
    return null;
  };

  if (transporte.modo !== r.modo_execucao) {
    const erro = `Servidor em modo ${transporte.modo}, conta em modo ${r.modo_execucao}: nada foi enviado.`;
    return r.modo === "criar" ? gravar({ resultado: "rejeitada", fase: "antes_do_provedor", erro }) : gravar({ resultado: "desconhecida", erro });
  }

  /** Posse do cliente (conta+pessoa) com token próprio. */
  const reservarCliente = () =>
    servico.rpc<ReservaCliente>(ROTINAS_EXECUTOR.clienteReservar, {
      ...base, _lease: lease, _timeout_req: transporte.timeoutRequisicaoSegundos,
    });
  const persistirCliente = async (token: string, c: { id: string; name: string }) => {
    await servico.rpc(ROTINAS_EXECUTOR.cliente, { ...base, _token: token, _external_id: c.id, _nome: c.name });
  };

  if (r.modo === "consultar") {
    // Resposta perdida ao criar o cliente: recupere-o pela referência estável.
    if (!r.customer_external_id) {
      try {
        const rc = await reservarCliente();
        if (rc.revisao) return revisar(new Error(rc.motivo ?? "Cliente externo ambíguo."));
        let clienteId = rc.external_id ?? null;
        if (!clienteId) {
          if (!rc.reservada || !rc.token) {
            return { id: intencaoId, state: r.state, reaproveitada: true, aviso: "Outra execução está preparando o cliente desta pessoa." };
          }
          const c = await transporte.localizarClientePorReferencia(refCliente(r.party_id));
          if (!c) return adiar("consulta_indisponivel", new ConsultaIndisponivel("Cliente externo ainda não foi localizado pela referência."));
          await persistirCliente(rc.token, c);
          clienteId = c.id;
        }
        // A primeira operação externa parou antes do POST da cobrança.
        return executarIntencaoAposCliente(transporte, r, clienteId, gravar, recuperavel, renovarIntencao, lease);
      } catch (e) {
        if (e instanceof ReferenciaAmbigua) return revisar(e);
        return (await recuperavel(e)) ?? adiar("consulta_indisponivel", e instanceof Error ? e : new Error(msg(e)));
      }
    }
    let achada;
    try {
      achada = await transporte.consultarCobrancaPorReferencia(r.internal_reference);
    } catch (e) {
      if (e instanceof ReferenciaAmbigua) return revisar(e);
      return (await recuperavel(e)) ?? adiar("consulta_indisponivel", e instanceof Error ? e : new Error(msg(e)));
    }
    if (!achada) {
      return gravar({ resultado: "rejeitada", fase: "sem_registro_apos_consulta", erro: "Provedor consultado: nenhuma cobrança com esta referência. Nova solicitação é permitida." });
    }
    const link = await obterLinkSeguro(transporte, achada.id, achada.invoiceUrl);
    return gravar({ resultado: "criada", external_id: achada.id, invoice_url: link, status: achada.status });
  }

  // ---- cliente: reservar conta+pessoa → consultar referência → criar se ausente → persistir com token
  let cliente = r.customer_external_id;
  let token: string | null = null;
  if (!cliente) {
    const rc = await reservarCliente();
    if (rc.revisao) return revisar(new Error(rc.motivo ?? "Cliente externo ambíguo."));
    if (rc.external_id) cliente = rc.external_id;
    else if (!rc.reservada || !rc.token) {
      return { id: intencaoId, state: "processando", reaproveitada: true, aviso: "Outra execução está preparando o cliente desta pessoa." };
    } else token = rc.token;
  }
  if (!cliente && token) {
    const tk = token;
    const renovarCliente = () =>
      servico.rpc(ROTINAS_EXECUTOR.clienteRenovar, { ...base, _token: tk, _lease: lease });
    try {
      const ref = refCliente(r.party_id);
      let c = await transporte.localizarClientePorReferencia(ref);
      if (!c) {
        await servico.rpc(ROTINAS_EXECUTOR.clienteEstado, { ...base, _token: tk, _state: "criar", _erro: null });
        c = await comRenovacao(
          () => transporte.prepararCliente({ name: r.devedor.nome ?? "Cliente", cpfCnpj: r.devedor.doc, ref }),
          () => Promise.all([renovarCliente(), renovarIntencao()]),
          lease,
        );
      }
      await persistirCliente(tk, c);
      cliente = c.id;
    } catch (e) {
      if (e instanceof ReferenciaAmbigua) return revisar(e);
      const adiada = recuperavel(e);
      if (adiada) return adiada;
      if (!(e instanceof FalhaAntesDoEnvio) && !(e instanceof RecusadoPeloProvedor)) {
        await servico.rpc(ROTINAS_EXECUTOR.clienteEstado, { ...base, _token: tk, _state: "desconhecida", _erro: msg(e) }).catch(() => undefined);
        return gravar({ resultado: "desconhecida", erro: `Cliente externo: ${msg(e)}` });
      }
      return gravar({ resultado: "rejeitada", fase: "cliente", erro: `Cliente externo: ${msg(e)}` });
    }
  }

  // ---- cobrança
  return executarIntencaoAposCliente(transporte, r, cliente!, gravar, recuperavel, renovarIntencao, lease);
}

async function executarIntencaoAposCliente(
  transporte: TransporteAsaas,
  r: Reserva,
  cliente: string,
  gravar: (payload: Record<string, unknown>) => Promise<ResultadoCobranca>,
  recuperavel: (e: unknown) => Promise<ResultadoCobranca> | null,
  renovar: () => Promise<unknown>,
  lease: number,
): Promise<ResultadoCobranca> {
  let criada;
  try {
    criada = await comRenovacao(
      () => transporte.criarCobranca({
        customer: cliente,
        valueCents: r.valor_cents,
        dueDate: r.due_date,
        billingType: r.billing_type,
        externalReference: r.internal_reference,
        idempotencyKey: r.internal_reference,
      }),
      renovar,
      lease,
    );
  } catch (e) {
    if (e instanceof FalhaAntesDoEnvio) return gravar({ resultado: "rejeitada", fase: "antes_do_provedor", erro: msg(e) });
    if (e instanceof CredencialRecusada || e instanceof LimiteDeRequisicoes) return recuperavel(e)!;
    if (e instanceof RecusadoPeloProvedor) return gravar({ resultado: "rejeitada", fase: "provedor_recusou", erro: msg(e) });
    // qualquer outra coisa depois do envio: pode ter criado. Nunca reenviar sem consultar.
    return gravar({ resultado: "desconhecida", erro: msg(e) });
  }

  const link = await obterLinkSeguro(transporte, criada.id, criada.invoiceUrl);
  return gravar({ resultado: "criada", external_id: criada.id, invoice_url: link, status: criada.status });
}

/** Link de cobrança já espelhada (criada aqui ou importada): consulta pelo ID, nunca cria. */
export async function obterLinkCobranca(servico: BancoAsaas, transporte: TransporteAsaas, chargeId: string, actor: string | null) {
  const c = await servico.rpc<{ charge_id: string; external_id: string; invoice_url: string | null; modo_execucao: string }>(
    ROTINAS_EXECUTOR.cobranca,
    { _charge: chargeId, _actor: actor },
  );
  if (c.invoice_url) return { charge_id: c.charge_id, invoice_url: c.invoice_url, consultado: false };
  if (c.modo_execucao !== transporte.modo) throw new Error("Modo do servidor incompatível com a conta desta cobrança.");
  const url = await transporte.obterLinkFatura(c.external_id);
  const r = await servico.rpc<{ invoice_url: string }>(ROTINAS_EXECUTOR.link, { _charge: chargeId, _actor: actor, _url: url });
  return { charge_id: c.charge_id, invoice_url: r.invoice_url, consultado: true };
}

/** Retomada: preparadas que não começaram, posses vencidas e desconhecidas. */
export async function retomarPendentes(
  servico: BancoAsaas,
  transportePorConta: (accountId: string) => Promise<TransporteAsaas>,
  o: OpcoesExecutor & { accountId?: string | null; preparadaSegundos?: number },
) {
  const lista = await servico.rpc<{ id: string; state: string; account_id: string }[]>(ROTINAS_EXECUTOR.pendentes, {
    _account: o.accountId ?? null,
    _preparada_seg: o.preparadaSegundos ?? 60,
    _limite: 50,
    ...opc(o),
  });
  const saida: ResultadoCobranca[] = [];
  for (const p of lista) {
    try {
      saida.push(await executarIntencao(servico, await transportePorConta(p.account_id), p.id, o));
    } catch (e) {
      saida.push({ id: p.id, state: p.state, erro: msg(e) });
    }
  }
  return saida;
}

/** Percurso completo do botão "Gerar link de cobrança". */
export async function gerarLinkDeCobranca(
  usuario: BancoAsaas,
  servico: BancoAsaas,
  transporte: TransporteAsaas,
  p: PedidoCobranca,
  o: OpcoesExecutor,
): Promise<ResultadoCobranca> {
  const it = await prepararIntencao(usuario, p);
  if (it.reaproveitada) {
    let url = it.invoice_url ?? null;
    if (!url && it.charge_id) url = (await obterLinkCobranca(servico, transporte, it.charge_id, o.actor).catch(() => null))?.invoice_url ?? null;
    return { state: "criada", invoice_url: url, external_id: it.external_id ?? null, charge_id: it.charge_id ?? null, reaproveitada: true, aviso: it.aviso ?? "" };
  }
  if (!it.id) throw new Error("Intenção não registrada.");
  if (o.contaEsperada && it.account_id && it.account_id !== o.contaEsperada) {
    throw new Error("A conta da intenção não corresponde à conta validada pelo servidor.");
  }
  if (it.state && !["preparada", "desconhecida", "aguardando_retentativa"].includes(it.state)) {
    return { id: it.id, state: it.state, invoice_url: it.invoice_url ?? null, external_id: it.external_id ?? null, reaproveitada: true };
  }
  return executarIntencao(servico, transporte, it.id, o);
}

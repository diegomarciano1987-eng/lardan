/**
 * Transporte SIMULADO, determinístico e persistente durante um cenário.
 *
 * Não há rede, credencial nem domínio do Asaas aqui. Os identificadores e o
 * endereço da fatura são explicitamente de demonstração.
 */
import {
  type ClienteExterno,
  type CobrancaExterna,
  type EventoExterno,
  type FiltroCobrancas,
  type NovaCobranca,
  type Pagina,
  RecusadoPeloProvedor,
  RespostaPerdida,
  type TransporteAsaas,
} from "./contrato";

export type Falha = "nenhuma" | "rejeitar" | "perder_resposta";

export interface OpcoesSimulador {
  semente?: string;
  clientes?: ClienteExterno[];
  cobrancas?: CobrancaExterna[];
  /** falha por referência interna da cobrança */
  falhas?: Record<string, Falha>;
}

export class SimuladorAsaas implements TransporteAsaas {
  readonly ambiente = "simulacao" as const;
  readonly simulado = true;

  private clientes = new Map<string, ClienteExterno>();
  private cobrancas = new Map<string, CobrancaExterna>();
  private porReferencia = new Map<string, string>();
  private eventos: EventoExterno[] = [];
  private falhas: Record<string, Falha>;
  private semente: string;
  private contador = 0;
  /** chamadas de criação recebidas, inclusive as que "perderam a resposta" */
  chamadasCriar = 0;

  constructor(o: OpcoesSimulador = {}) {
    this.semente = o.semente ?? "sim";
    this.falhas = o.falhas ?? {};
    for (const c of o.clientes ?? []) this.clientes.set(c.id, c);
    for (const c of o.cobrancas ?? []) {
      this.cobrancas.set(c.id, c);
      if (c.externalReference) this.porReferencia.set(c.externalReference, c.id);
    }
  }

  private id(prefixo: string) {
    this.contador += 1;
    return `sim_${prefixo}_${this.semente}_${String(this.contador).padStart(5, "0")}`;
  }

  /** endereço local e inequívoco: não é uma cobrança pagável */
  private link(id: string) {
    return `/financeiro/simulacao/${id}`;
  }

  definirFalha(ref: string, f: Falha) {
    this.falhas[ref] = f;
  }

  semearCobranca(c: Omit<CobrancaExterna, "id"> & { id?: string }): CobrancaExterna {
    const id = c.id ?? this.id("pay");
    const nova: CobrancaExterna = { ...c, id, invoiceUrl: this.link(id) };
    this.cobrancas.set(id, nova);
    if (nova.externalReference) this.porReferencia.set(nova.externalReference, id);
    return nova;
  }

  semearCliente(c: Omit<ClienteExterno, "id"> & { id?: string }): ClienteExterno {
    const id = c.id ?? this.id("cus");
    const novo: ClienteExterno = { ...c, id };
    this.clientes.set(id, novo);
    return novo;
  }

  enfileirarEvento(e: Omit<EventoExterno, "id"> & { id?: string }) {
    this.eventos.push({ ...e, id: e.id ?? this.id("evt") });
  }

  async listarClientes(f: { limit: number; offset: number }): Promise<Pagina<ClienteExterno>> {
    const todos = [...this.clientes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const itens = todos.slice(f.offset, f.offset + f.limit);
    return { itens, offset: f.offset, limit: f.limit, hasMore: f.offset + itens.length < todos.length, total: todos.length };
  }

  async consultarCliente(id: string) {
    return this.clientes.get(id) ?? null;
  }

  async localizarClientePorReferencia(ref: string) {
    const id = this.porReferencia.get(ref);
    return id ? (this.clientes.get(id) ?? null) : null;
  }

  async prepararCliente(d: { name: string; cpfCnpj?: string | null; email?: string | null; ref: string }) {
    const existente = await this.localizarClientePorReferencia(d.ref);
    if (existente) return existente;
    const novo = this.semearCliente({ name: d.name, cpfCnpj: d.cpfCnpj ?? null, email: d.email ?? null });
    this.porReferencia.set(d.ref, novo.id);
    return novo;
  }

  async listarCobrancas(f: FiltroCobrancas): Promise<Pagina<CobrancaExterna>> {
    let todas = [...this.cobrancas.values()].sort((a, b) => a.id.localeCompare(b.id));
    if (f.customer) todas = todas.filter((c) => c.customer === f.customer);
    const emAberto = (c: CobrancaExterna) => !["RECEIVED", "RECEIVED_IN_CASH", "CONFIRMED", "DELETED", "REFUNDED"].includes(c.status);
    todas = todas.filter((c) => {
      const depoisDoInicio = !f.dueDateGE || c.dueDate >= f.dueDateGE;
      const antesDoFim = !f.dueDateLE || c.dueDate <= f.dueDateLE;
      if (depoisDoInicio && antesDoFim) return true;
      // dívida antiga ainda devida não some por causa da data de corte
      return Boolean(f.incluirEmAbertoAnteriores) && !depoisDoInicio && emAberto(c);
    });
    const itens = todas.slice(f.offset, f.offset + f.limit);
    return { itens, offset: f.offset, limit: f.limit, hasMore: f.offset + itens.length < todas.length, total: todas.length };
  }

  async consultarCobranca(id: string) {
    return this.cobrancas.get(id) ?? null;
  }

  async consultarCobrancaPorReferencia(ref: string) {
    const id = this.porReferencia.get(ref);
    return id ? (this.cobrancas.get(id) ?? null) : null;
  }

  async criarCobranca(n: NovaCobranca): Promise<CobrancaExterna> {
    this.chamadasCriar += 1;
    const falha = this.falhas[n.externalReference] ?? "nenhuma";
    if (falha === "rejeitar") {
      throw new RecusadoPeloProvedor("Cobrança recusada pelo provedor (simulação).");
    }
    // o provedor NÃO garante unicidade por externalReference: a correlação é nossa
    const criada = this.semearCobranca({
      customer: n.customer,
      valueCents: n.valueCents,
      dueDate: n.dueDate,
      billingType: n.billingType,
      status: "PENDING",
      description: n.description ?? null,
      externalReference: n.externalReference,
      dateCreated: new Date().toISOString().slice(0, 10),
    });
    if (falha === "perder_resposta") {
      // criou lá, mas a resposta não chega aqui
      throw new RespostaPerdida();
    }
    return criada;
  }

  async obterLinkFatura(chargeId: string) {
    const c = this.cobrancas.get(chargeId);
    if (!c) throw new RecusadoPeloProvedor("Cobrança inexistente no provedor.");
    return c.invoiceUrl ?? this.link(chargeId);
  }

  async receberEventos() {
    const fila = this.eventos;
    this.eventos = [];
    return fila;
  }

  /** ajuda de cenário: aplica um recebimento e enfileira o evento correspondente */
  registrarRecebimento(chargeId: string, dados: { pagoCents: number; tarifaCents: number; data: string }) {
    const c = this.cobrancas.get(chargeId);
    if (!c) throw new RecusadoPeloProvedor("Cobrança inexistente.");
    c.status = "RECEIVED";
    c.valuePaidCents = dados.pagoCents;
    c.feeCents = dados.tarifaCents;
    c.netValueCents = dados.pagoCents - dados.tarifaCents;
    c.paymentDate = dados.data;
    c.creditDate = dados.data;
    this.enfileirarEvento({
      event: "PAYMENT_RECEIVED",
      chargeExternalId: chargeId,
      eventAt: `${dados.data}T12:00:00Z`,
      payload: {
        valuePaidCents: dados.pagoCents,
        feeCents: dados.tarifaCents,
        netValueCents: dados.pagoCents - dados.tarifaCents,
        paymentDate: dados.data,
        creditDate: dados.data,
      },
    });
  }
}

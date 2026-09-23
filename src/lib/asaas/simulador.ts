/**
 * Transporte SIMULADO, determinístico e isolado por conta.
 *
 * Não há rede, credencial nem domínio do Asaas aqui. Os identificadores e o
 * endereço da fatura são explicitamente de demonstração. Cada conta tem o seu
 * próprio simulador (identificadores com o prefixo da conta), e o estado pode
 * ser gravado num armazenamento para sobreviver a reinício do servidor.
 */
import {
  type ClienteExterno,
  type CobrancaExterna,
  type EventoExterno,
  type FiltroCobrancas,
  type NovaCobranca,
  type Pagina,
  RecusadoPeloProvedor,
  ReferenciaAmbigua,
  RespostaPerdida,
  type TransporteAsaas,
} from "./contrato";

/** Falhas programáveis por referência interna. */
export type Falha = "nenhuma" | "rejeitar" | "perder_resposta" | "sem_link" | "erro_inesperado";
export type FalhaCliente = "nenhuma" | "rejeitar" | "perder_resposta";

export interface EstadoSimulador {
  versao: 1;
  contador: number;
  chamadasCriar: number;
  chamadasCriarCliente: number;
  clientes: ClienteExterno[];
  cobrancas: CobrancaExterna[];
  referencias: [string, string][];
  refClientes: [string, string][];
  eventos: EventoExterno[];
  semLink: string[];
}

export interface Armazenamento {
  carregar(): EstadoSimulador | null;
  salvar(e: EstadoSimulador): void;
}

export interface OpcoesSimulador {
  semente?: string;
  /** conta a que este simulador pertence; entra no identificador */
  conta?: string;
  clientes?: ClienteExterno[];
  cobrancas?: CobrancaExterna[];
  /** falha por referência interna da cobrança */
  falhas?: Record<string, Falha>;
  /** falha por referência do cliente (lardan:party:<id>) */
  falhasCliente?: Record<string, FalhaCliente>;
  armazenamento?: Armazenamento;
}

const limparSemente = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "sim";

export class SimuladorAsaas implements TransporteAsaas {
  readonly ambiente = "simulacao" as const;
  readonly simulado = true;
  readonly modo = "simulado" as const;
  readonly conta: string | null;

  private clientes = new Map<string, ClienteExterno>();
  private cobrancas = new Map<string, CobrancaExterna>();
  private porReferencia = new Map<string, string>();
  private refClientes = new Map<string, string>();
  private eventos: EventoExterno[] = [];
  private semLink = new Set<string>();
  private falhas: Record<string, Falha>;
  private falhasCliente: Record<string, FalhaCliente>;
  private semente: string;
  private contador = 0;
  private armazenamento: Armazenamento | undefined;
  /** chamadas de criação recebidas, inclusive as que "perderam a resposta" */
  chamadasCriar = 0;
  chamadasCriarCliente = 0;

  constructor(o: OpcoesSimulador = {}) {
    this.conta = o.conta ?? null;
    const prefixoConta = o.conta ? limparSemente(o.conta.replace(/-/g, "").slice(0, 8)) : "";
    this.semente = limparSemente([prefixoConta, o.semente ?? "sim"].filter(Boolean).join("_"));
    this.falhas = o.falhas ?? {};
    this.falhasCliente = o.falhasCliente ?? {};
    this.armazenamento = o.armazenamento;
    const salvo = this.armazenamento?.carregar() ?? null;
    if (salvo) {
      this.restaurar(salvo);
    } else {
      for (const c of o.clientes ?? []) this.clientes.set(c.id, c);
      for (const c of o.cobrancas ?? []) {
        this.cobrancas.set(c.id, c);
        if (c.externalReference) this.porReferencia.set(c.externalReference, c.id);
      }
    }
  }

  private restaurar(e: EstadoSimulador) {
    this.contador = e.contador;
    this.chamadasCriar = e.chamadasCriar;
    this.chamadasCriarCliente = e.chamadasCriarCliente;
    this.clientes = new Map(e.clientes.map((c) => [c.id, c]));
    this.cobrancas = new Map(e.cobrancas.map((c) => [c.id, c]));
    this.porReferencia = new Map(e.referencias);
    this.refClientes = new Map(e.refClientes);
    this.eventos = e.eventos;
    this.semLink = new Set(e.semLink);
  }

  exportar(): EstadoSimulador {
    return {
      versao: 1,
      contador: this.contador,
      chamadasCriar: this.chamadasCriar,
      chamadasCriarCliente: this.chamadasCriarCliente,
      clientes: [...this.clientes.values()],
      cobrancas: [...this.cobrancas.values()],
      referencias: [...this.porReferencia.entries()],
      refClientes: [...this.refClientes.entries()],
      eventos: this.eventos,
      semLink: [...this.semLink],
    };
  }

  private gravar() {
    this.armazenamento?.salvar(this.exportar());
  }

  get vazio() {
    return this.cobrancas.size === 0 && this.clientes.size === 0;
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

  definirFalhaCliente(ref: string, f: FalhaCliente) {
    this.falhasCliente[ref] = f;
  }

  /** Importada sem link no payload: o link só aparece consultando pelo ID. */
  semearCobranca(c: Omit<CobrancaExterna, "id"> & { id?: string }, o: { semLinkNaListagem?: boolean } = {}): CobrancaExterna {
    const id = c.id ?? this.id("pay");
    const nova: CobrancaExterna = { ...c, id, invoiceUrl: this.link(id) };
    this.cobrancas.set(id, nova);
    if (nova.externalReference) this.porReferencia.set(nova.externalReference, id);
    if (o.semLinkNaListagem) this.semLink.add(id);
    this.gravar();
    return nova;
  }

  semearCliente(c: Omit<ClienteExterno, "id"> & { id?: string }, ref?: string): ClienteExterno {
    const id = c.id ?? this.id("cus");
    const novo: ClienteExterno = { ...c, id };
    this.clientes.set(id, novo);
    if (ref) this.refClientes.set(ref, id);
    this.gravar();
    return novo;
  }

  enfileirarEvento(e: Omit<EventoExterno, "id"> & { id?: string }) {
    this.eventos.push({ ...e, id: e.id ?? this.id("evt") });
    this.gravar();
  }

  private publica(c: CobrancaExterna): CobrancaExterna {
    return this.semLink.has(c.id) ? { ...c, invoiceUrl: null } : { ...c };
  }

  async listarClientes(f: { limit: number; offset: number }): Promise<Pagina<ClienteExterno>> {
    const todos = [...this.clientes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const itens = todos.slice(f.offset, f.offset + f.limit);
    return { itens, quantidadeBruta: itens.length, offset: f.offset, limit: f.limit, hasMore: f.offset + itens.length < todos.length, total: todos.length, proximoOffset: f.offset + itens.length };
  }

  async consultarCliente(id: string) {
    return this.clientes.get(id) ?? null;
  }

  async localizarClientePorReferencia(ref: string) {
    const id = this.refClientes.get(ref);
    return id ? (this.clientes.get(id) ?? null) : null;
  }

  async prepararCliente(d: { name: string; cpfCnpj?: string | null; email?: string | null; ref: string }) {
    this.chamadasCriarCliente += 1;
    const falha = this.falhasCliente[d.ref] ?? "nenhuma";
    if (falha === "rejeitar") {
      this.gravar();
      throw new RecusadoPeloProvedor("Cliente recusado pelo provedor (simulação).", 400, ["invalid_customer"]);
    }
    const existente = await this.localizarClientePorReferencia(d.ref);
    const cliente = existente ?? this.semearCliente({ name: d.name, cpfCnpj: d.cpfCnpj ?? null, email: d.email ?? null }, d.ref);
    this.gravar();
    if (falha === "perder_resposta") {
      this.falhasCliente[d.ref] = "nenhuma";
      throw new RespostaPerdida("Resposta da criação do cliente não recebida (simulação).");
    }
    return cliente;
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
    const itens = todas.slice(f.offset, f.offset + f.limit).map((c) => this.publica(c));
    return { itens, quantidadeBruta: itens.length, offset: f.offset, limit: f.limit, hasMore: f.offset + itens.length < todas.length, total: todas.length, proximoOffset: f.offset + itens.length };
  }

  async consultarCobranca(id: string) {
    const c = this.cobrancas.get(id);
    return c ? { ...c } : null;
  }

  async consultarCobrancaPorReferencia(ref: string) {
    const achadas = [...this.cobrancas.values()].filter((c) => c.externalReference === ref);
    if (achadas.length > 1) throw new ReferenciaAmbigua(ref, achadas.length);
    return achadas[0] ? { ...achadas[0] } : null;
  }

  async criarCobranca(n: NovaCobranca): Promise<CobrancaExterna> {
    this.chamadasCriar += 1;
    const falha = this.falhas[n.externalReference] ?? "nenhuma";
    if (falha === "rejeitar") {
      this.gravar();
      throw new RecusadoPeloProvedor("Cobrança recusada pelo provedor (simulação).", 400, ["invalid_value"]);
    }
    if (!this.clientes.has(n.customer)) {
      this.gravar();
      throw new RecusadoPeloProvedor("Cliente inexistente no provedor (simulação).", 400, ["invalid_customer"]);
    }
    // o provedor NÃO garante unicidade por externalReference: a correlação é nossa
    const criada = this.semearCobranca(
      {
        customer: n.customer,
        valueCents: n.valueCents,
        dueDate: n.dueDate,
        billingType: n.billingType,
        status: "PENDING",
        description: n.description ?? null,
        externalReference: n.externalReference,
        dateCreated: new Date().toISOString().slice(0, 10),
      },
      { semLinkNaListagem: falha === "sem_link" },
    );
    if (falha === "perder_resposta") {
      this.falhas[n.externalReference] = "nenhuma";
      // criou lá, mas a resposta não chega aqui
      throw new RespostaPerdida();
    }
    if (falha === "erro_inesperado") {
      this.falhas[n.externalReference] = "nenhuma";
      throw new Error("Falha inesperada depois do envio (simulação).");
    }
    return this.publica(criada);
  }

  async obterLinkFatura(chargeId: string) {
    const c = this.cobrancas.get(chargeId);
    if (!c) throw new RecusadoPeloProvedor("Cobrança inexistente no provedor.", 404, ["not_found"]);
    if (this.semLink.has(chargeId) && this.falhas[c.externalReference ?? ""] === "sem_link") {
      // primeira consulta do link falha; a seguinte devolve
      this.falhas[c.externalReference ?? ""] = "nenhuma";
      throw new RespostaPerdida("Link da fatura não obtido (simulação).");
    }
    return c.invoiceUrl ?? this.link(chargeId);
  }

  async receberEventos() {
    const fila = this.eventos;
    this.eventos = [];
    this.gravar();
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

/**
 * Transporte HTTP do Asaas — requisições reais montadas, REDE BLOQUEADA.
 *
 * Monta endereço, cabeçalhos, corpo, tradução de campos e valores monetários,
 * paginação e classificação de erros conforme a documentação oficial atual
 * (docs.asaas.com, consultada em 23/09/2026):
 *   base sandbox  https://api-sandbox.asaas.com/v3   (chave $aact_hmlg_…)
 *   base produção https://api.asaas.com/v3           (chave $aact_prod_…)
 *   autenticação  cabeçalho `access_token` (não usa Authorization: Bearer)
 *   paginação     offset + limit (máx. 100); resposta { hasMore, totalCount, data }
 *   erros         { errors: [{ code, description }] }; 400/401/403/404/429/5xx
 *   valores       reais em número decimal; aqui sempre centavos inteiros
 *
 * O `fetch` é injetável. O padrão é `fetchBloqueado`, que recusa ANTES de
 * qualquer acesso à rede. Não presumimos unicidade de externalReference nem
 * idempotência no provedor: a correlação e a repetição são controladas por nós.
 */
import {
  type ClienteExterno,
  type CobrancaExterna,
  ConsultaIndisponivel,
  CredencialRecusada,
  type EventoExterno,
  FalhaAntesDoEnvio,
  type FiltroCobrancas,
  type FormaPagamento,
  LimiteDeRequisicoes,
  type NovaCobranca,
  type Pagina,
  RecusadoPeloProvedor,
  ReferenciaAmbigua,
  RespostaPerdida,
  type AmbienteProvedor,
  type TransporteAsaas,
} from "./contrato";

export const BASE: Record<AmbienteProvedor, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  producao: "https://api.asaas.com/v3",
};

export class ChamadaExternaBloqueada extends FalhaAntesDoEnvio {
  constructor(rota: string) {
    super(
      `Chamada externa bloqueada nesta preparação (${rota}). ` +
        "A conexão com o Asaas depende de homologação e de credencial do servidor.",
    );
    this.name = "ChamadaExternaBloqueada";
  }
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Padrão desta rodada: nada sai para a rede. */
export const fetchBloqueado: Fetch = async (url, init) => {
  throw new ChamadaExternaBloqueada(`${init.method ?? "GET"} ${new URL(url).pathname}`);
};

export interface OpcoesHttp {
  ambiente: AmbienteProvedor;
  chave: string;
  fetch?: Fetch;
  userAgent?: string;
}

/* ------------------------------------------------------------ dinheiro */
export function paraCentavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Valor monetário inválido: ${String(v)}`);
  return Math.round(n * 100);
}

export function paraReais(c: number): number {
  if (!Number.isInteger(c) || c < 0) throw new Error(`Centavos inválidos: ${c}`);
  return Number((c / 100).toFixed(2));
}

/* ------------------------------------------------------------ tradução */
type Json = Record<string, unknown>;
const txt = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

export function traduzirCobranca(p: Json): CobrancaExterna {
  if (!txt(p["id"])) throw new Error("Cobrança sem identificador na resposta.");
  return {
    id: p["id"] as string,
    customer: String(p["customer"] ?? ""),
    valueCents: paraCentavos(p["value"]) ?? 0,
    netValueCents: paraCentavos(p["netValue"]),
    // tarifa e valor pago não vêm confiáveis na listagem: desconhecido fica null
    feeCents: null,
    valuePaidCents: null,
    refundedCents: null,
    dueDate: String(p["dueDate"] ?? ""),
    paymentDate: txt(p["paymentDate"]) ?? txt(p["clientPaymentDate"]),
    creditDate: txt(p["creditDate"]),
    billingType: (txt(p["billingType"]) ?? "UNDEFINED") as FormaPagamento,
    status: String(p["status"] ?? ""),
    description: txt(p["description"]),
    externalReference: txt(p["externalReference"]),
    dateCreated: txt(p["dateCreated"]),
    invoiceUrl: txt(p["invoiceUrl"]),
  };
}

export function traduzirCliente(p: Json): ClienteExterno {
  if (!txt(p["id"])) throw new Error("Cliente sem identificador na resposta.");
  return { id: p["id"] as string, name: String(p["name"] ?? ""), cpfCnpj: txt(p["cpfCnpj"]), email: txt(p["email"]) };
}

/* ------------------------------------------------------------ erros */
function codigos(corpo: unknown): { codigos: string[]; texto: string } {
  const errs = (corpo as { errors?: { code?: string; description?: string }[] } | null)?.errors ?? [];
  return {
    codigos: errs.map((e) => e.code ?? "desconhecido"),
    texto: errs.map((e) => e.description ?? e.code).filter(Boolean).join("; ") || "Recusado pelo provedor.",
  };
}

/**
 * Classificação:
 *  POST sem resposta, 5xx ou corpo ilegível → RespostaPerdida (pode ter criado)
 *  GET sem resposta ou 5xx → ConsultaIndisponivel (não diz nada)
 *  400/404/409/422 → RecusadoPeloProvedor (não criou)
 *  401/403 → CredencialRecusada; 429 → LimiteDeRequisicoes (não processou)
 */
export function classificar(metodo: string, status: number, corpo: unknown, retryAfter: string | null): Error {
  const c = codigos(corpo);
  if (status === 401 || status === 403) return new CredencialRecusada(status, c.codigos);
  if (status === 429) return new LimiteDeRequisicoes(retryAfter ? Number(retryAfter) || null : null);
  if (status >= 500) {
    return metodo === "GET"
      ? new ConsultaIndisponivel(`Provedor indisponível (${status}).`)
      : new RespostaPerdida(`Provedor respondeu ${status}: resultado desconhecido.`);
  }
  return new RecusadoPeloProvedor(c.texto, status, c.codigos);
}

export class TransporteHttpAsaas implements TransporteAsaas {
  readonly simulado = false;
  readonly modo = "conectado" as const;
  readonly ambiente: AmbienteProvedor;
  private readonly chave: string;
  private readonly fetch: Fetch;
  private readonly userAgent: string;

  constructor(o: OpcoesHttp) {
    this.ambiente = o.ambiente;
    this.chave = o.chave;
    this.fetch = o.fetch ?? fetchBloqueado;
    this.userAgent = o.userAgent ?? "Lardan/1.0 (recebiveis)";
  }

  /** Monta a requisição sem enviá-la (usado também pelos testes). */
  montar(metodo: "GET" | "POST", caminho: string, o: { query?: Record<string, string | number | null | undefined>; corpo?: Json } = {}) {
    const url = new URL(BASE[this.ambiente] + caminho);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.userAgent,
      access_token: this.chave,
    };
    const init: RequestInit = { method: metodo, headers };
    if (metodo !== "GET" && o.corpo) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(o.corpo);
    }
    return { url: url.toString(), init };
  }

  private async enviar<T>(metodo: "GET" | "POST", caminho: string, o: Parameters<TransporteHttpAsaas["montar"]>[2] = {}, aceitar404 = false): Promise<T | null> {
    if (!this.chave) throw new FalhaAntesDoEnvio("Credencial do servidor ausente.");
    const { url, init } = this.montar(metodo, caminho, o);
    let r: Response;
    try {
      r = await this.fetch(url, init);
    } catch (e) {
      if (e instanceof FalhaAntesDoEnvio) throw e;
      throw metodo === "GET"
        ? new ConsultaIndisponivel(`Consulta sem resposta: ${(e as Error).message}`)
        : new RespostaPerdida(`Envio sem resposta: ${(e as Error).message}`);
    }
    let corpo: unknown = null;
    const bruto = await r.text().catch(() => "");
    try {
      corpo = bruto ? JSON.parse(bruto) : null;
    } catch {
      if (r.ok) {
        throw metodo === "GET" ? new ConsultaIndisponivel("Resposta ilegível.") : new RespostaPerdida("Resposta ilegível após envio.");
      }
    }
    if (r.status === 404 && aceitar404) return null;
    if (!r.ok) throw classificar(metodo, r.status, corpo, r.headers.get("retry-after"));
    return corpo as T;
  }

  private pagina<T>(corpo: Json | null, f: { limit: number; offset: number }, tr: (j: Json) => T): Pagina<T> {
    const data = Array.isArray(corpo?.["data"]) ? (corpo!["data"] as Json[]) : [];
    return {
      itens: data.map(tr),
      offset: f.offset,
      limit: f.limit,
      hasMore: Boolean(corpo?.["hasMore"]),
      total: typeof corpo?.["totalCount"] === "number" ? (corpo!["totalCount"] as number) : null,
      proximoOffset: f.offset + data.length,
    };
  }

  async listarClientes(f: { limit: number; offset: number }) {
    const lim = Math.min(Math.max(f.limit, 1), 100);
    const c = await this.enviar<Json>("GET", "/customers", { query: { offset: f.offset, limit: lim } });
    return this.pagina(c, { limit: lim, offset: f.offset }, traduzirCliente);
  }

  async consultarCliente(id: string) {
    const c = await this.enviar<Json>("GET", `/customers/${encodeURIComponent(id)}`, {}, true);
    return c ? traduzirCliente(c) : null;
  }

  async localizarClientePorReferencia(ref: string) {
    const c = await this.enviar<Json>("GET", "/customers", { query: { externalReference: ref, limit: 10, offset: 0 } });
    const p = this.pagina(c, { limit: 10, offset: 0 }, traduzirCliente);
    if (p.itens.length > 1) throw new ReferenciaAmbigua(ref, p.itens.length);
    return p.itens[0] ?? null;
  }

  async prepararCliente(d: { name: string; cpfCnpj?: string | null; email?: string | null; ref: string }) {
    const c = await this.enviar<Json>("POST", "/customers", {
      corpo: {
        name: d.name,
        ...(d.cpfCnpj ? { cpfCnpj: d.cpfCnpj } : {}),
        ...(d.email ? { email: d.email } : {}),
        externalReference: d.ref,
        notificationDisabled: true,
      },
    });
    return traduzirCliente(c!);
  }

  async listarCobrancas(f: FiltroCobrancas) {
    const lim = Math.min(Math.max(f.limit, 1), 100);
    // A API não expressa "janela OU em aberto anterior": sem dueDate[ge] e filtro local.
    const c = await this.enviar<Json>("GET", "/payments", {
      query: {
        offset: f.offset,
        limit: lim,
        "dueDate[ge]": f.incluirEmAbertoAnteriores ? null : f.dueDateGE,
        "dueDate[le]": f.dueDateLE,
        customer: f.customer,
      },
    });
    const p = this.pagina(c, { limit: lim, offset: f.offset }, traduzirCobranca);
    if (f.incluirEmAbertoAnteriores && f.dueDateGE) {
      const aberto = (x: CobrancaExterna) => ["PENDING", "OVERDUE"].includes(x.status);
      p.itens = p.itens.filter((x) => x.dueDate >= f.dueDateGE! || aberto(x));
    }
    return p;
  }

  async consultarCobranca(id: string) {
    const c = await this.enviar<Json>("GET", `/payments/${encodeURIComponent(id)}`, {}, true);
    return c ? traduzirCobranca(c) : null;
  }

  async consultarCobrancaPorReferencia(ref: string) {
    const c = await this.enviar<Json>("GET", "/payments", { query: { externalReference: ref, limit: 10, offset: 0 } });
    const p = this.pagina(c, { limit: 10, offset: 0 }, traduzirCobranca);
    const vivas = p.itens.filter((x) => x.status !== "DELETED");
    if (vivas.length > 1) throw new ReferenciaAmbigua(ref, vivas.length);
    return vivas[0] ?? null;
  }

  async criarCobranca(n: NovaCobranca) {
    const c = await this.enviar<Json>("POST", "/payments", {
      corpo: {
        customer: n.customer,
        billingType: n.billingType,
        value: paraReais(n.valueCents),
        dueDate: n.dueDate,
        ...(n.description ? { description: n.description } : {}),
        externalReference: n.externalReference,
      },
    });
    try {
      return traduzirCobranca(c!);
    } catch {
      throw new RespostaPerdida("Resposta de criação sem identificador legível.");
    }
  }

  async obterLinkFatura(id: string) {
    const c = await this.consultarCobranca(id);
    if (!c) throw new RecusadoPeloProvedor("Cobrança inexistente no provedor.", 404, ["not_found"]);
    if (!c.invoiceUrl) throw new ConsultaIndisponivel("Provedor não devolveu o endereço da fatura.");
    return c.invoiceUrl;
  }

  async receberEventos(): Promise<EventoExterno[]> {
    // eventos reais chegam pelo webhook, não por consulta
    return [];
  }
}

/**
 * Transporte HTTP do Asaas — PREPARADO E BLOQUEADO.
 *
 * Nada aqui faz chamada externa nesta rodada: toda requisição passa por
 * `bloqueio()`, que recusa antes de qualquer acesso à rede. As credenciais,
 * quando existirem, serão lidas do ambiente do SERVIDOR; a interface nunca
 * escolhe endereço nem chave.
 *
 * Endereços oficiais (documentação do provedor), aqui só como constante:
 *   sandbox:  https://api-sandbox.asaas.com/v3
 *   produção: https://api.asaas.com/v3
 */
import {
  type Ambiente,
  type ClienteExterno,
  type CobrancaExterna,
  type EventoExterno,
  type FiltroCobrancas,
  type NovaCobranca,
  type Pagina,
  type TransporteAsaas,
} from "./contrato";

const BASE: Record<Exclude<Ambiente, "simulacao">, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  producao: "https://api.asaas.com/v3",
};

export class ChamadaExternaBloqueada extends Error {
  constructor(rota: string) {
    super(
      `Chamada externa bloqueada nesta preparação (${rota}). ` +
        "A conexão com o Asaas depende de homologação e de credencial do servidor.",
    );
    this.name = "ChamadaExternaBloqueada";
  }
}

export class TransporteHttpAsaas implements TransporteAsaas {
  readonly simulado = false;

  constructor(
    readonly ambiente: Exclude<Ambiente, "simulacao">,
    private readonly nomeDoSegredo: string,
  ) {}

  /** ponto único de saída: enquanto a integração não é liberada, ninguém passa daqui */
  private bloqueio(rota: string): never {
    void BASE[this.ambiente];
    void this.nomeDoSegredo;
    throw new ChamadaExternaBloqueada(rota);
  }

  listarClientes(_f: { limit: number; offset: number }): Promise<Pagina<ClienteExterno>> {
    return this.bloqueio("GET /customers");
  }
  consultarCliente(_id: string): Promise<ClienteExterno | null> {
    return this.bloqueio("GET /customers/:id");
  }
  localizarClientePorReferencia(_ref: string): Promise<ClienteExterno | null> {
    return this.bloqueio("GET /customers?externalReference");
  }
  prepararCliente(_d: { name: string; cpfCnpj?: string | null; email?: string | null; ref: string }): Promise<ClienteExterno> {
    return this.bloqueio("POST /customers");
  }
  listarCobrancas(_f: FiltroCobrancas): Promise<Pagina<CobrancaExterna>> {
    return this.bloqueio("GET /payments");
  }
  consultarCobranca(_id: string): Promise<CobrancaExterna | null> {
    return this.bloqueio("GET /payments/:id");
  }
  consultarCobrancaPorReferencia(_ref: string): Promise<CobrancaExterna | null> {
    return this.bloqueio("GET /payments?externalReference");
  }
  criarCobranca(_n: NovaCobranca): Promise<CobrancaExterna> {
    return this.bloqueio("POST /payments");
  }
  obterLinkFatura(_id: string): Promise<string> {
    return this.bloqueio("GET /payments/:id (invoiceUrl)");
  }
  receberEventos(): Promise<EventoExterno[]> {
    return this.bloqueio("webhook");
  }
}

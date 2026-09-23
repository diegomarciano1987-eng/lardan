/**
 * Configuração e escolha do transporte — decisão exclusiva do SERVIDOR.
 *
 * Modo de execução (simulado | conectado) é separado do ambiente do provedor
 * (sandbox | producao). Configuração ausente, ambígua ou inválida deixa a
 * integração INDISPONÍVEL — nunca cai silenciosamente em simulação nem em
 * produção. Nesta rodada, mesmo "conectado" usa rede bloqueada.
 */
import type { AmbienteProvedor, TransporteAsaas } from "./contrato";
import { type Armazenamento, type EstadoSimulador, SimuladorAsaas } from "./simulador";

export * from "./contrato";
export { SimuladorAsaas } from "./simulador";
export type { BancoAsaas } from "./banco";

export type ConfigAsaas =
  | { disponivel: true; modo: "simulado"; ambiente: null; demoIsolado: boolean }
  | { disponivel: true; modo: "conectado"; ambiente: AmbienteProvedor; demoIsolado: false }
  | { disponivel: false; motivo: string };

type Env = Record<string, string | undefined>;

export function lerConfiguracao(env: Env): ConfigAsaas {
  const modo = env["ASAAS_MODO"];
  const amb = env["ASAAS_AMBIENTE"];
  const chave = env["ASAAS_API_KEY"];
  const demo = env["LARDAN_DEMO_ISOLADO"] === "1";
  if (!modo) return { disponivel: false, motivo: "Integração Asaas não configurada neste servidor." };
  if (modo === "simulado") {
    if (amb) return { disponivel: false, motivo: "Modo simulado não aceita ambiente de provedor configurado." };
    if (chave) return { disponivel: false, motivo: "Credencial presente em modo simulado: configuração ambígua." };
    return { disponivel: true, modo: "simulado", ambiente: null, demoIsolado: demo };
  }
  if (modo === "conectado") {
    if (demo) return { disponivel: false, motivo: "Demonstração isolada não pode rodar em modo conectado." };
    if (amb !== "sandbox" && amb !== "producao") return { disponivel: false, motivo: "Ambiente do provedor ausente ou inválido." };
    if (!chave) return { disponivel: false, motivo: "Credencial do servidor ausente." };
    const prefixo = amb === "sandbox" ? "$aact_hmlg_" : "$aact_prod_";
    if (!chave.startsWith(prefixo)) return { disponivel: false, motivo: "Credencial não pertence ao ambiente configurado." };
    return { disponivel: true, modo: "conectado", ambiente: amb, demoIsolado: false };
  }
  return { disponivel: false, motivo: "Modo de execução do Asaas inválido." };
}

export function configuracaoDoServidor(): ConfigAsaas {
  const env = (globalThis as { process?: { env?: Env } }).process?.env ?? {};
  return lerConfiguracao(env);
}

export class IntegracaoIndisponivel extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "IntegracaoIndisponivel";
  }
}

/* ---------- simuladores: um por conta, com estado gravado opcionalmente ---------- */
const G = globalThis as { __lardanSimuladores?: Map<string, SimuladorAsaas> };

async function armazenamentoEmArquivo(accountId: string): Promise<Armazenamento | undefined> {
  const dir = (globalThis as { process?: { env?: Env } }).process?.env?.["LARDAN_SIM_DIR"];
  if (!dir) return undefined;
  const fs = await import("node:fs");
  const caminho = `${dir}/${accountId.replace(/[^A-Za-z0-9-]/g, "")}.json`;
  fs.mkdirSync(dir, { recursive: true });
  return {
    carregar: () => (fs.existsSync(caminho) ? (JSON.parse(fs.readFileSync(caminho, "utf8")) as EstadoSimulador) : null),
    salvar: (e) => fs.writeFileSync(caminho, JSON.stringify(e)),
  };
}

export async function simuladorDaConta(accountId: string): Promise<SimuladorAsaas> {
  G.__lardanSimuladores ??= new Map();
  let s = G.__lardanSimuladores.get(accountId);
  if (!s) {
    const armazenamento = await armazenamentoEmArquivo(accountId);
    s = new SimuladorAsaas({ conta: accountId, semente: "srv", ...(armazenamento ? { armazenamento } : {}) });
    G.__lardanSimuladores.set(accountId, s);
  }
  return s;
}

export async function criarTransporte(accountId: string, config: ConfigAsaas = configuracaoDoServidor()): Promise<TransporteAsaas> {
  if (!config.disponivel) throw new IntegracaoIndisponivel(config.motivo);
  if (config.modo === "simulado") return simuladorDaConta(accountId);
  const { TransporteHttpAsaas } = await import("./transporte-http.server");
  const chave = (globalThis as { process?: { env?: Env } }).process?.env?.["ASAAS_API_KEY"] ?? "";
  // rede bloqueada nesta rodada: fetch padrão recusa antes de sair
  return new TransporteHttpAsaas({ ambiente: config.ambiente, chave });
}

export const CONECTADO = false;
export const AVISO_SIMULACAO = "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL";

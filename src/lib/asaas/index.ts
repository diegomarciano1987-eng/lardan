/**
 * Ponto de entrada do módulo Asaas e simuladores por conta (ambiente isolado).
 * A configuração é resolvida SOMENTE por conta em `configuracao.server.ts`;
 * não existe configuração global concorrente.
 */
type Env = Record<string, string | undefined>;
import { type Armazenamento, type EstadoSimulador, SimuladorAsaas } from "./simulador";

export * from "./contrato";
export { SimuladorAsaas } from "./simulador";
export type { BancoAsaas } from "./banco";

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

export const CONECTADO = false;
export const AVISO_SIMULACAO = "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL";

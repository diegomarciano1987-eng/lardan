/**
 * Escolha do transporte — decisão exclusiva do SERVIDOR.
 *
 * O navegador não transforma produção em simulação nem o contrário, não informa
 * endereço e não informa credencial. Enquanto a integração não for homologada,
 * qualquer ambiente diferente de simulação devolve um transporte que recusa a
 * chamada antes de sair para a rede.
 */
import type { Ambiente, TransporteAsaas } from "./contrato";
import { SimuladorAsaas } from "./simulador";

export * from "./contrato";
export { SimuladorAsaas } from "./simulador";
export type { BancoAsaas } from "./banco";

export function ambienteDoServidor(): Ambiente {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.["ASAAS_AMBIENTE"];
  return v === "sandbox" || v === "producao" ? v : "simulacao";
}

export async function criarTransporte(ambiente: Ambiente = ambienteDoServidor()): Promise<TransporteAsaas> {
  if (ambiente === "simulacao") return new SimuladorAsaas({ semente: "servidor" });
  const { TransporteHttpAsaas } = await import("./transporte-http.server");
  return new TransporteHttpAsaas(ambiente, "ASAAS_API_KEY");
}

export const CONECTADO = false;
export const AVISO_SIMULACAO = "SIMULAÇÃO — NÃO É UMA COBRANÇA PAGÁVEL";

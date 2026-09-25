/**
 * Resolução ÚNICA de configuração do Asaas — por conta, somente no servidor.
 *
 * Fonte de verdade:
 *  1. conta Asaas vinculada à empresa (estado e ambiente registrados no banco);
 *  2. `secret_ref` na conta contendo apenas o NOME do segredo (ex.: ASAAS_SANDBOX_LARDAN);
 *  3. valor do segredo lido exclusivamente aqui, do ambiente do servidor;
 *  4. ASAAS_CONNECTED_ACCOUNT_ID — UUID da única conta autorizada neste servidor;
 *  5. ASAAS_EGRESS_ENABLED=1 — gate explícito de saída externa (desligado por padrão).
 *
 * Nada aqui é enviado ao navegador além de `publico()`, que não contém chave,
 * token, nome de segredo ou configuração sensível.
 */
import type { TransporteAsaas } from "./contrato";
import type { Fetch } from "./transporte-http.server";

type Env = Record<string, string | undefined>;

export type SituacaoPublica =
  | "simulada"
  | "preparada"
  | "sandbox_configurado"
  | "producao_configurado"
  | "saida_desligada"
  | "credencial_ausente"
  | "conta_suspensa"
  | "indisponivel";

export const ROTULO_SITUACAO: Record<SituacaoPublica, string> = {
  simulada: "Conta simulada",
  preparada: "Preparada",
  sandbox_configurado: "Sandbox configurado",
  producao_configurado: "Produção configurada",
  saida_desligada: "Saída externa desligada",
  credencial_ausente: "Credencial ausente ou incompatível",
  conta_suspensa: "Conta suspensa",
  indisponivel: "Indisponível",
};

/** Resposta do banco (asaas_conta_situacao / preflight). */
export interface SituacaoBanco {
  ok: boolean;
  situacao: string;
  motivo?: string;
  account_id?: string;
  state?: string;
  modo?: "simulado" | "conectado";
  ambiente?: "sandbox" | "producao" | null;
  secret_ref?: string | null;
  invoice_host_confirmed?: boolean;
}

export type Resolucao =
  | {
      executavel: true;
      accountId: string;
      situacao: "simulada" | "sandbox_configurado" | "producao_configurado";
      motivo: string;
      transporte: { tipo: "simulador" } | { tipo: "http"; ambiente: "sandbox" | "producao"; chave: string };
    }
  | { executavel: false; accountId: string | null; situacao: SituacaoPublica; motivo: string };

const NOME_SEGREDO_SANDBOX = /^ASAAS_SANDBOX_[A-Z0-9_]{1,48}$/;
const PREFIXO_SANDBOX = "$aact_hmlg_";
const NOME_SEGREDO_PRODUCAO = /^ASAAS_PRODUCAO_[A-Z0-9_]{1,48}$/;
const PREFIXO_PRODUCAO = "$aact_prod_";

const conhecida = (s: string): SituacaoPublica =>
  (Object.keys(ROTULO_SITUACAO) as SituacaoPublica[]).includes(s as SituacaoPublica) ? (s as SituacaoPublica) : "indisponivel";

/** Exigências comuns aos dois ambientes conectados: chave válida, conta autorizada, egress ligado. */
function exigirConectado(
  conta: string | null,
  ref: string,
  chave: string | undefined,
  env: Env,
  nomeValido: (r: string) => boolean,
  prefixo: string,
  situacao: "sandbox_configurado" | "producao_configurado",
  motivoOk: string,
  ambiente: "sandbox" | "producao",
): Resolucao {
  const nao = (s: SituacaoPublica, m: string): Resolucao => ({ executavel: false, accountId: conta, situacao: s, motivo: m });
  if (!nomeValido(ref)) return nao("credencial_ausente", "Credencial do servidor ausente ou incompatível com o ambiente.");
  if (!chave || !chave.startsWith(prefixo)) return nao("credencial_ausente", "Credencial do servidor ausente ou incompatível com o ambiente.");
  const autorizada = env["ASAAS_CONNECTED_ACCOUNT_ID"];
  if (!autorizada || autorizada !== conta) return nao("indisponivel", "Esta conta não é a conta autorizada neste servidor.");
  if (env["ASAAS_EGRESS_ENABLED"] !== "1") return nao("saida_desligada", `${ambiente === "producao" ? "Produção" : "Sandbox"} preparado, mas a saída externa está desligada neste servidor.`);
  return { executavel: true, accountId: conta!, situacao, motivo: motivoOk, transporte: { tipo: "http", ambiente, chave } };
}

export function resolverConta(b: SituacaoBanco, env: Env): Resolucao {
  const conta = b.account_id ?? null;
  const nao = (situacao: SituacaoPublica, motivo: string): Resolucao => ({ executavel: false, accountId: conta, situacao, motivo });
  if (!b.ok || !conta) return nao(conhecida(b.situacao), b.motivo ?? ROTULO_SITUACAO[conhecida(b.situacao)]);

  if (b.modo === "simulado") {
    if (b.ambiente) return nao("indisponivel", "Configuração da conta incoerente.");
    if (env["LARDAN_DEMO_ISOLADO"] !== "1") return nao("indisponivel", "Simulação disponível somente no ambiente isolado.");
    return { executavel: true, accountId: conta, situacao: "simulada", motivo: "Simulação isolada — não é cobrança pagável.", transporte: { tipo: "simulador" } };
  }
  if (b.modo !== "conectado") return nao("indisponivel", "Configuração da conta incoerente.");
  if (b.ambiente === "producao") {
    if (b.state !== "producao_conectada") return nao("indisponivel", "Configuração da conta incoerente.");
    return exigirConectado(conta, b.secret_ref ?? "", b.secret_ref ? env[b.secret_ref] : undefined, env,
      (r) => NOME_SEGREDO_PRODUCAO.test(r), PREFIXO_PRODUCAO, "producao_configurado", "Produção configurada.", "producao");
  }
  if (b.ambiente !== "sandbox") return nao("indisponivel", "Configuração da conta incoerente.");
  return exigirConectado(conta, b.secret_ref ?? "", b.secret_ref ? env[b.secret_ref] : undefined, env,
    (r) => NOME_SEGREDO_SANDBOX.test(r), PREFIXO_SANDBOX, "sandbox_configurado", "Sandbox configurado.", "sandbox");
}

export interface ContaPublica {
  id: string;
  nome: string;
  situacao: SituacaoPublica;
  rotulo: string;
  motivo: string;
  operacoes: { importar: boolean; cobrar: boolean; link: boolean; recuperar: boolean };
}

/** Versão sanitizada: nunca inclui chave, token nem nome de segredo. */
export function publico(r: Resolucao, id: string, nome: string): ContaPublica {
  const pode = r.executavel;
  return {
    id,
    nome,
    situacao: r.situacao,
    rotulo: ROTULO_SITUACAO[r.situacao],
    motivo: r.motivo,
    operacoes: { importar: pode, cobrar: pode, link: pode, recuperar: pode },
  };
}

export class IntegracaoIndisponivel extends Error {
  constructor(motivo: string, readonly situacao: SituacaoPublica = "indisponivel") {
    super(motivo);
    this.name = "IntegracaoIndisponivel";
  }
}

/**
 * Fábrica de transporte. Com a resolução não executável (inclusive gate
 * desligado) recusa ANTES de construir qualquer cliente HTTP: nenhuma
 * resolução DNS nem requisição começa. Só com tudo válido e o gate ligado o
 * `fetch` real do servidor é injetado.
 */
export async function transporteDaResolucao(r: Resolucao, deps: { fetch?: Fetch } = {}): Promise<TransporteAsaas> {
  if (!r.executavel) throw new IntegracaoIndisponivel(r.motivo, r.situacao);
  if (r.transporte.tipo === "simulador") {
    const { simuladorDaConta } = await import("./index");
    return simuladorDaConta(r.accountId);
  }
  const { TransporteHttpAsaas } = await import("./transporte-http.server");
  const fetchReal: Fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  return new TransporteHttpAsaas({ ambiente: r.transporte.ambiente, chave: r.transporte.chave, fetch: fetchReal });
}

export const envDoServidor = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

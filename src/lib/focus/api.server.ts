/**
 * Transporte Focus NFe (API v2). Somente servidor.
 *
 * Autenticação: HTTP Basic com o token da empresa como usuário e senha vazia.
 * Fail-closed: sem token do ambiente ou sem saída de rede liberada
 * (FOCUS_EGRESS_ENABLED=true), nada é enviado e nada é simulado.
 *
 * Segredos (Lovable > Secrets):
 *   FOCUS_TOKEN_HOMOLOGACAO   token de homologação da empresa (Painel API > Tokens)
 *   FOCUS_TOKEN_PRODUCAO      token de produção (só quando a produção for liberada)
 *   FOCUS_WEBHOOK_SECRET      segredo longo e aleatório para o aviso da Focus
 *   FOCUS_WEBHOOK_URL         https://<domínio publicado>/api/public/focus/webhook
 *   FOCUS_CNPJ_EMITENTE       43319208000180 (usado se fiscal_settings não tiver emissor)
 *   FOCUS_UF_EMITENTE         PR
 *   FOCUS_EGRESS_ENABLED      true
 */
import type { AmbienteNfe } from "./nfe";

const BASE: Record<AmbienteNfe, string> = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

const TOKEN_ENV: Record<AmbienteNfe, string> = {
  homologacao: "FOCUS_TOKEN_HOMOLOGACAO",
  producao: "FOCUS_TOKEN_PRODUCAO",
};

/** Nome do cabeçalho que a Focus usa para mandar o segredo no aviso. */
export const CABECALHO_AVISO = "X-Lardan-Focus";

export interface ConfigFocus {
  ambiente: AmbienteNfe;
  pronto: boolean;
  faltando: string[];
  avisoPronto: boolean;
}

export function avaliarConfigFocus(ambiente: AmbienteNfe): ConfigFocus {
  const faltando: string[] = [];
  if (!process.env[TOKEN_ENV[ambiente]]) faltando.push(TOKEN_ENV[ambiente]);
  if (process.env["FOCUS_EGRESS_ENABLED"] !== "true") faltando.push("FOCUS_EGRESS_ENABLED");
  const avisoPronto = Boolean(process.env["FOCUS_WEBHOOK_SECRET"] && process.env["FOCUS_WEBHOOK_URL"]);
  return { ambiente, pronto: faltando.length === 0, faltando, avisoPronto };
}

export class ErroFocus extends Error {
  constructor(
    message: string,
    readonly http: number | null = null,
    readonly corpo: unknown = null,
  ) {
    super(message);
  }
}

/** Link absoluto para um caminho devolvido pela Focus (/arquivos...). */
export function urlArquivo(ambiente: AmbienteNfe, caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  if (/^https?:\/\//.test(caminho)) return caminho;
  return `${BASE[ambiente]}${caminho.startsWith("/") ? "" : "/"}${caminho}`;
}

async function chamar<T>(ambiente: AmbienteNfe, metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<{ http: number; dados: T }> {
  const cfg = avaliarConfigFocus(ambiente);
  if (!cfg.pronto) throw new ErroFocus(`Focus não configurada: falta ${cfg.faltando.join(", ")}.`);
  const token = process.env[TOKEN_ENV[ambiente]]!;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(`${BASE[ambiente]}/v2${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: corpo === undefined ? null : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const texto = await resp.text();
    let dados: unknown = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = { mensagem: texto.slice(0, 500) };
    }
    if (resp.status === 401 || resp.status === 403) throw new ErroFocus("A Focus recusou o token (confira o token do ambiente).", resp.status, dados);
    return { http: resp.status, dados: dados as T };
  } catch (e) {
    if (e instanceof ErroFocus) throw e;
    throw new ErroFocus((e as Error).name === "AbortError" ? "A Focus não respondeu em 30 segundos." : "Falha de rede ao falar com a Focus.");
  } finally {
    clearTimeout(t);
  }
}

export interface RespostaNfe {
  ref?: string;
  status?: string;
  status_sefaz?: string;
  mensagem_sefaz?: string;
  chave_nfe?: string;
  numero?: string;
  serie?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  caminho_xml_cancelamento?: string;
  erros?: { codigo?: string; campo?: string; mensagem?: string }[];
  codigo?: string;
  mensagem?: string;
}

/** Envia a NF-e (assíncrono: a Focus responde 202 "processando_autorizacao"). */
export async function emitirNfe(ambiente: AmbienteNfe, ref: string, nfe: Record<string, unknown>) {
  const r = await chamar<RespostaNfe>(ambiente, "POST", `/nfe?ref=${encodeURIComponent(ref)}`, nfe);
  // 422 "already_processed"/"pending_operation": a referência já existe lá; a consulta traz o estado real
  if (r.http === 422 && (r.dados?.codigo === "already_processed" || r.dados?.codigo === "pending_operation")) {
    return consultarNfe(ambiente, ref);
  }
  if (r.http >= 400) {
    return { http: r.http, dados: { ...r.dados, status: "erro_envio", mensagem_sefaz: r.dados?.mensagem ?? `Focus respondeu ${r.http}.` } as RespostaNfe };
  }
  return r;
}

export function consultarNfe(ambiente: AmbienteNfe, ref: string) {
  return chamar<RespostaNfe>(ambiente, "GET", `/nfe/${encodeURIComponent(ref)}?completa=0`);
}

export function cancelarNfe(ambiente: AmbienteNfe, ref: string, justificativa: string) {
  const j = justificativa.trim();
  if (j.length < 15 || j.length > 255) throw new ErroFocus("A justificativa precisa ter de 15 a 255 caracteres.");
  return chamar<RespostaNfe>(ambiente, "DELETE", `/nfe/${encodeURIComponent(ref)}`, { justificativa: j });
}

/** Cadastra na Focus o aviso (gatilho) de NF-e apontando para o nosso webhook. */
export async function registrarAviso(ambiente: AmbienteNfe, cnpj: string) {
  const url = process.env["FOCUS_WEBHOOK_URL"];
  const segredo = process.env["FOCUS_WEBHOOK_SECRET"];
  if (!url || !segredo) throw new ErroFocus("Falta FOCUS_WEBHOOK_URL ou FOCUS_WEBHOOK_SECRET.");
  if (!/^https:\/\//.test(url)) throw new ErroFocus("FOCUS_WEBHOOK_URL precisa começar com https://");
  const atuais = await chamar<{ id: string; url: string; event: string }[]>(ambiente, "GET", "/hooks");
  const ja = Array.isArray(atuais.dados) ? atuais.dados.find((h) => h.event === "nfe" && h.url === url) : undefined;
  if (ja) return { criado: false, id: ja.id };
  const r = await chamar<{ id?: string; mensagem?: string }>(ambiente, "POST", "/hooks", {
    cnpj: cnpj.replace(/\D/g, ""),
    event: "nfe",
    url,
    authorization: segredo,
    authorization_header: CABECALHO_AVISO,
  });
  if (r.http >= 400) throw new ErroFocus(r.dados?.mensagem ?? `Focus respondeu ${r.http} ao cadastrar o aviso.`, r.http, r.dados);
  return { criado: true, id: r.dados?.id ?? null };
}

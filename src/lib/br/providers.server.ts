/**
 * Adapters servidor-a-servidor das consultas públicas (CEP, CNPJ, IBGE).
 *
 * Regras deste arquivo:
 * - nenhuma chamada externa acontece no navegador;
 * - allowlist fixa de hosts (evita SSRF): o navegador nunca escolhe a URL;
 * - timeout curto, no máximo uma retentativa, cache por chave e rate limit;
 * - resposta externa validada e mapeada para contrato próprio antes de entrar
 *   no sistema; campos desconhecidos são descartados;
 * - auditoria em public.integration_lookups sem dado pessoal excedente.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SIGLAS_UF } from "./ufs";

const HOSTS_PERMITIDOS = new Set([
  "viacep.com.br",
  "brasilapi.com.br",
  "servicodados.ibge.gov.br",
]);

export const TIMEOUT_MS = 4000;
export const TTL_CEP_HORAS = 24 * 30;
export const TTL_CNPJ_HORAS = 24;
export const TTL_IBGE_HORAS = 24 * 90;
export const LIMITE_CONSULTAS_MINUTO = 30;

export type StatusConsulta =
  | "ok"
  | "nao_encontrado"
  | "dado_invalido"
  | "limite"
  | "timeout"
  | "indisponivel"
  | "incompativel";

export interface Resultado<T> {
  status: StatusConsulta;
  provider: string;
  consultado_em: string;
  cache: boolean;
  dados: T | null;
  mensagem: string | null;
}

/* ----------------------------------------------------------- infraestrutura */

/**
 * Costura de teste: a bancada de homologação substitui o transporte para
 * simular 404, 429, timeout e queda de provedor sem depender da internet.
 * Em produção nada chama isto e o valor permanece o `fetch` do runtime.
 */
type Transporte = (url: string, init: RequestInit) => Promise<Response>;
let transporte: Transporte | null = null;
export function __definirTransporteDeTeste(t: Transporte | null) {
  transporte = t;
}

async function buscar(url: string, timeout = TIMEOUT_MS): Promise<Response> {
  const host = new URL(url).hostname;
  if (!HOSTS_PERMITIDOS.has(host)) throw new Error(`Host não permitido: ${host}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const init: RequestInit = {
    signal: ctrl.signal,
    headers: { accept: "application/json", "user-agent": "LardanCloud/1.0" },
  };
  try {
    return await (transporte ? transporte(url, init) : fetch(url, init));
  } finally {
    clearTimeout(t);
  }
}

/** Uma única retentativa segura, só para falha de rede/timeout. */
async function buscarComRetry(url: string) {
  try {
    return await buscar(url);
  } catch {
    return await buscar(url, TIMEOUT_MS);
  }
}

async function hashResposta(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lerCache<T>(provider: string, chave: string): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("integration_cache")
    .select("payload, expires_at")
    .eq("provider", provider)
    .eq("chave", chave)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.payload as T;
}

async function gravarCache(provider: string, chave: string, payload: unknown, horas: number) {
  await supabaseAdmin.from("integration_cache").upsert(
    {
      provider,
      chave,
      payload: payload as never,
      response_hash: await hashResposta(payload),
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + horas * 3600_000).toISOString(),
    },
    { onConflict: "provider,chave" },
  );
}

async function auditar(linha: {
  provider: string;
  kind: string;
  referencia: string | null;
  status: StatusConsulta;
  latency_ms: number;
  cache_hit: boolean;
  error_code?: string | null;
  user_id: string | null;
  http_status?: number | null;
}) {
  await supabaseAdmin.from("integration_lookups").insert({
    provider: linha.provider,
    kind: linha.kind,
    referencia: linha.referencia,
    status: linha.status,
    latency_ms: linha.latency_ms,
    cache_hit: linha.cache_hit,
    error_code: linha.error_code ?? null,
    http_status: linha.http_status ?? null,
    user_id: linha.user_id,
  });
}

/** Rate limit por usuário, contado na própria auditoria. */
async function excedeuLimite(userId: string | null) {
  if (!userId) return false;
  const desde = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from("integration_lookups")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", desde);
  return (count ?? 0) >= LIMITE_CONSULTAS_MINUTO;
}

const agora = () => new Date().toISOString();

/* ------------------------------------------------------------------- CEP -- */

export interface EnderecoConsultado {
  cep: string;
  logradouro: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  ibge: string | null;
  ddd: string | null;
}

function mapearViaCep(j: Record<string, unknown>): EnderecoConsultado | null {
  if (j["erro"]) return null;
  const cep = String(j["cep"] ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return null;
  const texto = (k: string) => {
    const v = j[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;
  };
  const uf = texto("uf")?.toUpperCase() ?? null;
  return {
    cep,
    logradouro: texto("logradouro"),
    complemento: texto("complemento"),
    bairro: texto("bairro"),
    cidade: texto("localidade"),
    uf: uf && SIGLAS_UF.includes(uf) ? uf : null,
    ibge: texto("ibge")?.replace(/\D/g, "") || null,
    ddd: texto("ddd")?.replace(/\D/g, "") || null,
  };
}

function mapearBrasilApiCep(j: Record<string, unknown>): EnderecoConsultado | null {
  const cep = String(j["cep"] ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return null;
  const texto = (k: string) => {
    const v = j[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null;
  };
  const uf = texto("state")?.toUpperCase() ?? null;
  return {
    cep,
    logradouro: texto("street"),
    complemento: null,
    bairro: texto("neighborhood"),
    cidade: texto("city"),
    uf: uf && SIGLAS_UF.includes(uf) ? uf : null,
    ibge: null,
    ddd: null,
  };
}

export async function lookupAddressByPostalCode(
  cepEntrada: string,
  userId: string | null,
): Promise<Resultado<EnderecoConsultado>> {
  const cep = cepEntrada.replace(/\D/g, "");
  const base = { provider: "viacep", consultado_em: agora(), cache: false, dados: null } as const;
  if (cep.length !== 8)
    return { ...base, status: "dado_invalido", mensagem: "CEP precisa ter 8 dígitos." };

  if (await excedeuLimite(userId))
    return { ...base, status: "limite", mensagem: "Muitas consultas seguidas. Aguarde um instante." };

  const cacheado = await lerCache<EnderecoConsultado>("viacep", cep);
  if (cacheado) {
    await auditar({
      provider: "viacep", kind: "cep", referencia: cep, status: "ok",
      latency_ms: 0, cache_hit: true, user_id: userId,
    });
    return { ...base, status: "ok", cache: true, dados: cacheado, mensagem: null };
  }

  const inicio = Date.now();
  const tentativas: { provider: string; url: string; mapear: (j: Record<string, unknown>) => EnderecoConsultado | null }[] = [
    { provider: "viacep", url: `https://viacep.com.br/ws/${cep}/json/`, mapear: mapearViaCep },
    { provider: "brasilapi", url: `https://brasilapi.com.br/api/cep/v1/${cep}`, mapear: mapearBrasilApiCep },
  ];

  let ultimoStatus: StatusConsulta = "indisponivel";
  let ultimoCodigo: string | null = null;

  for (const t of tentativas) {
    try {
      const resp = await buscarComRetry(t.url);
      if (resp.status === 404) {
        ultimoStatus = "nao_encontrado";
        ultimoCodigo = "404";
        continue;
      }
      if (!resp.ok) {
        ultimoStatus = resp.status === 429 ? "limite" : "indisponivel";
        ultimoCodigo = String(resp.status);
        continue;
      }
      const json = (await resp.json()) as Record<string, unknown>;
      const dados = t.mapear(json);
      if (!dados) {
        ultimoStatus = "nao_encontrado";
        ultimoCodigo = "vazio";
        continue;
      }
      await gravarCache(t.provider === "viacep" ? "viacep" : "brasilapi", cep, dados, TTL_CEP_HORAS);
      await auditar({
        provider: t.provider, kind: "cep", referencia: cep, status: "ok",
        latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, http_status: resp.status,
      });
      return { status: "ok", provider: t.provider, consultado_em: agora(), cache: false, dados, mensagem: null };
    } catch (e) {
      ultimoStatus = e instanceof Error && e.name === "AbortError" ? "timeout" : "indisponivel";
      ultimoCodigo = ultimoStatus;
    }
  }

  await auditar({
    provider: "viacep", kind: "cep", referencia: cep, status: ultimoStatus,
    latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, error_code: ultimoCodigo,
  });
  return {
    status: ultimoStatus,
    provider: "viacep",
    consultado_em: agora(),
    cache: false,
    dados: null,
    mensagem:
      ultimoStatus === "nao_encontrado"
        ? "CEP não localizado. Você pode preencher o endereço manualmente."
        : "Consulta de CEP indisponível agora. Preencha o endereço manualmente.",
  };
}

/* ------------------------------------------------------------------ CNPJ -- */

export interface EmpresaConsultada {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  situacao_data: string | null;
  abertura: string | null;
  natureza_juridica: string | null;
  porte: string | null;
  capital_social: number | null;
  atividade_principal: string | null;
  atividades_secundarias: string[];
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  socios: { nome: string; qualificacao: string | null }[];
}

function texto(v: unknown, max = 200) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function mapearBrasilApiCnpj(j: Record<string, unknown>): EmpresaConsultada | null {
  const cnpj = String(j["cnpj"] ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cnpj.length !== 14) return null;
  const secundarias = Array.isArray(j["cnaes_secundarios"])
    ? (j["cnaes_secundarios"] as Record<string, unknown>[])
        .map((c) => texto(c["descricao"]))
        .filter((x): x is string => !!x)
        .slice(0, 15)
    : [];
  const socios = Array.isArray(j["qsa"])
    ? (j["qsa"] as Record<string, unknown>[])
        .map((s) => ({
          nome: texto(s["nome_socio"]) ?? "",
          qualificacao: texto(s["qualificacao_socio"]),
        }))
        .filter((s) => s.nome)
        .slice(0, 20)
    : [];
  const uf = texto(j["uf"])?.toUpperCase() ?? null;
  const capital = typeof j["capital_social"] === "number" ? (j["capital_social"] as number) : null;
  return {
    cnpj,
    razao_social: texto(j["razao_social"]),
    nome_fantasia: texto(j["nome_fantasia"]),
    situacao: texto(j["descricao_situacao_cadastral"]),
    situacao_data: texto(j["data_situacao_cadastral"], 40),
    abertura: texto(j["data_inicio_atividade"], 40),
    natureza_juridica: texto(j["natureza_juridica"]),
    porte: texto(j["porte"]),
    capital_social: capital,
    atividade_principal: texto(j["cnae_fiscal_descricao"]),
    atividades_secundarias: secundarias,
    logradouro: texto(j["logradouro"], 120),
    numero: texto(j["numero"], 12),
    complemento: texto(j["complemento"], 80),
    bairro: texto(j["bairro"], 80),
    cep: String(j["cep"] ?? "").replace(/\D/g, "").slice(0, 8) || null,
    cidade: texto(j["municipio"], 80),
    uf: uf && SIGLAS_UF.includes(uf) ? uf : null,
    telefone: texto(j["ddd_telefone_1"], 20),
    email: texto(j["email"], 254),
    socios,
  };
}

export async function lookupCompanyByTaxId(
  entrada: string,
  userId: string | null,
  opcoes: { comQsa: boolean },
): Promise<Resultado<EmpresaConsultada>> {
  const cnpj = entrada.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const base = { provider: "brasilapi", consultado_em: agora(), cache: false, dados: null } as const;
  if (cnpj.length !== 14)
    return { ...base, status: "dado_invalido", mensagem: "CNPJ precisa ter 14 caracteres." };

  if (/[A-Z]/.test(cnpj)) {
    // Provedor público ainda opera sobre a base numérica. Isso NÃO invalida o CNPJ.
    await auditar({
      provider: "brasilapi", kind: "cnpj", referencia: cnpj, status: "incompativel",
      latency_ms: 0, cache_hit: false, user_id: userId, error_code: "alfanumerico",
    });
    return {
      ...base,
      status: "incompativel",
      mensagem:
        "CNPJ alfanumérico aceito e validado pelo sistema. O provedor público ainda não consulta esse formato — preencha os dados manualmente.",
    };
  }

  if (await excedeuLimite(userId))
    return { ...base, status: "limite", mensagem: "Muitas consultas seguidas. Aguarde um instante." };

  const cacheado = await lerCache<EmpresaConsultada>("brasilapi_cnpj", cnpj);
  if (cacheado) {
    await auditar({
      provider: "brasilapi", kind: "cnpj", referencia: cnpj, status: "ok",
      latency_ms: 0, cache_hit: true, user_id: userId,
    });
    return {
      ...base,
      status: "ok",
      cache: true,
      dados: opcoes.comQsa ? cacheado : { ...cacheado, socios: [] },
      mensagem: null,
    };
  }

  const inicio = Date.now();
  try {
    const resp = await buscarComRetry(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    if (resp.status === 404) {
      await auditar({
        provider: "brasilapi", kind: "cnpj", referencia: cnpj, status: "nao_encontrado",
        latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, http_status: 404,
      });
      return { ...base, status: "nao_encontrado", mensagem: "CNPJ não localizado na base pública." };
    }
    if (!resp.ok) {
      const status: StatusConsulta = resp.status === 429 ? "limite" : "indisponivel";
      await auditar({
        provider: "brasilapi", kind: "cnpj", referencia: cnpj, status,
        latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId,
        http_status: resp.status, error_code: String(resp.status),
      });
      return { ...base, status, mensagem: "Consulta de CNPJ indisponível agora. Preencha manualmente." };
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const dados = mapearBrasilApiCnpj(json);
    if (!dados) {
      await auditar({
        provider: "brasilapi", kind: "cnpj", referencia: cnpj, status: "incompativel",
        latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, error_code: "schema",
      });
      return { ...base, status: "incompativel", mensagem: "Resposta do provedor não pôde ser interpretada." };
    }
    await gravarCache("brasilapi_cnpj", cnpj, dados, TTL_CNPJ_HORAS);
    await auditar({
      provider: "brasilapi", kind: "cnpj", referencia: cnpj, status: "ok",
      latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, http_status: resp.status,
    });
    return {
      status: "ok",
      provider: "brasilapi",
      consultado_em: agora(),
      cache: false,
      dados: opcoes.comQsa ? dados : { ...dados, socios: [] },
      mensagem: null,
    };
  } catch (e) {
    const status: StatusConsulta = e instanceof Error && e.name === "AbortError" ? "timeout" : "indisponivel";
    await auditar({
      provider: "brasilapi", kind: "cnpj", referencia: cnpj, status,
      latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, error_code: status,
    });
    return { ...base, status, mensagem: "Consulta de CNPJ indisponível agora. Preencha manualmente." };
  }
}

/* ------------------------------------------------------------------ IBGE -- */

export interface Municipio {
  codigo_ibge: string;
  nome: string;
}

/**
 * Municípios por UF. Ficam guardados no banco: o IBGE é chamado no máximo uma
 * vez por UF a cada 90 dias, e a lista nacional nunca é baixada inteira.
 */
export async function listMunicipalitiesByState(
  ufEntrada: string,
  userId: string | null,
): Promise<Resultado<Municipio[]>> {
  const uf = ufEntrada.toUpperCase();
  const base = { provider: "ibge", consultado_em: agora(), cache: false, dados: null } as const;
  if (!SIGLAS_UF.includes(uf)) return { ...base, status: "dado_invalido", mensagem: "UF inválida." };

  const { data: guardados } = await supabaseAdmin
    .from("ibge_municipios")
    .select("codigo_ibge, nome, synced_at")
    .eq("uf", uf)
    .order("nome");

  const fresco =
    guardados &&
    guardados.length > 0 &&
    Date.now() - new Date(guardados[0]!.synced_at).getTime() < TTL_IBGE_HORAS * 3600_000;

  if (fresco) {
    return {
      ...base,
      status: "ok",
      cache: true,
      dados: guardados.map((m) => ({ codigo_ibge: m.codigo_ibge, nome: m.nome })),
      mensagem: null,
    };
  }

  const inicio = Date.now();
  try {
    const resp = await buscarComRetry(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
    );
    if (!resp.ok) throw new Error(String(resp.status));
    const json = (await resp.json()) as { id: number; nome: string }[];
    const linhas = json
      .filter((m) => typeof m.id === "number" && typeof m.nome === "string")
      .map((m) => ({ codigo_ibge: String(m.id), uf, nome: m.nome.slice(0, 80), synced_at: agora() }));
    if (linhas.length) {
      await supabaseAdmin.from("ibge_municipios").upsert(linhas, { onConflict: "codigo_ibge" });
    }
    await auditar({
      provider: "ibge", kind: "municipios", referencia: uf, status: "ok",
      latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, http_status: resp.status,
    });
    return {
      status: "ok",
      provider: "ibge",
      consultado_em: agora(),
      cache: false,
      dados: linhas.map((m) => ({ codigo_ibge: m.codigo_ibge, nome: m.nome })),
      mensagem: null,
    };
  } catch (e) {
    const status: StatusConsulta = e instanceof Error && e.name === "AbortError" ? "timeout" : "indisponivel";
    await auditar({
      provider: "ibge", kind: "municipios", referencia: uf, status,
      latency_ms: Date.now() - inicio, cache_hit: false, user_id: userId, error_code: status,
    });
    // fallback seguro: o que já estiver guardado continua servindo
    if (guardados && guardados.length) {
      return {
        ...base,
        status: "ok",
        cache: true,
        dados: guardados.map((m) => ({ codigo_ibge: m.codigo_ibge, nome: m.nome })),
        mensagem: "Lista local (IBGE indisponível agora).",
      };
    }
    return { ...base, status, mensagem: "Lista de municípios indisponível. Digite a cidade manualmente." };
  }
}

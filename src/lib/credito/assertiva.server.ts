/**
 * 0394 — Cliente da API da Assertiva (só servidor). Chaves só nos segredos: ASSERTIVA_CLIENT_ID / ASSERTIVA_CLIENT_SECRET.
 * Documentação: https://integracao.assertivasolucoes.com.br/v3/portal/credito/reference
 *  - token: POST /oauth2/v3/token (Basic id:secret, grant_type=client_credentials), validade em expires_in;
 *  - crédito PF: GET /score/v3/pf/credito/{cpf}?idFinalidade=2 (2 = ciclo de crédito, exigido pela LGPD).
 *    200 = resposta; 202 = CPF inexistente; 429 = mesma consulta nos últimos 2 minutos.
 * Nunca registra CPF nem a resposta em log.
 */
const BASE = "https://api.assertivasolucoes.com.br";

let tokenCache: { valor: string; expira: number } | null = null;

export class ErroAssertiva extends Error {
  constructor(msg: string, public http: number | null = null) {
    super(msg);
  }
}

function chaves() {
  const id = process.env['ASSERTIVA_CLIENT_ID'];
  const segredo = process.env['ASSERTIVA_CLIENT_SECRET'];
  if (!id || !segredo) throw new ErroAssertiva("As chaves da Assertiva não estão configuradas (ASSERTIVA_CLIENT_ID / ASSERTIVA_CLIENT_SECRET).");
  return { id, segredo };
}

async function token(): Promise<string> {
  if (tokenCache && tokenCache.expira > Date.now() + 10_000) return tokenCache.valor;
  const { id, segredo } = chaves();
  const r = await fetch(`${BASE}/oauth2/v3/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${segredo}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new ErroAssertiva(r.status === 401 ? "A Assertiva recusou as chaves (401). Confira os segredos." : `Falha ao autenticar na Assertiva (${r.status}).`, r.status);
  const j = (await r.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new ErroAssertiva("A Assertiva não devolveu o token.");
  const segundos = Math.max(30, Math.min(Number(j.expires_in ?? 60), 3600));
  tokenCache = { valor: j.access_token, expira: Date.now() + segundos * 1000 };
  return j.access_token;
}

/** Consulta o crédito PF. Devolve o HTTP e o corpo (JSON) para o banco guardar e aplicar a regra. */
export async function consultarCreditoPF(cpf: string): Promise<{ http: number; corpo: Record<string, unknown> }> {
  const digitos = cpf.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digitos)) throw new ErroAssertiva("CPF inválido.");
  const tentar = async () =>
    fetch(`${BASE}/score/v3/pf/credito/${digitos}?idFinalidade=2`, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  let r = await tentar();
  if (r.status === 401) {
    tokenCache = null; // token vencido antes da hora: pega outro uma vez
    r = await tentar();
  }
  if (r.status === 429) throw new ErroAssertiva("A Assertiva já está consultando este CPF (aguarde 2 minutos).", 429);
  if (r.status === 401 || r.status === 403) throw new ErroAssertiva("A Assertiva recusou a consulta (sem permissão para o produto de crédito).", r.status);
  let corpo: Record<string, unknown> = {};
  try {
    corpo = (await r.json()) as Record<string, unknown>;
  } catch {
    corpo = {};
  }
  return { http: r.status, corpo };
}

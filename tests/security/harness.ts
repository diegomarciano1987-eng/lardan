/**
 * Bancada de homologação de segurança do LARDAN Cloud.
 *
 * Cria (ou reaproveita) contas sintéticas de teste — uma por papel — e devolve
 * um cliente REST autenticado para cada uma. Nenhum usuário real é tocado:
 * todas as contas usam o domínio @lardan.test e o prefixo `homolog`.
 *
 * A chave de serviço é lida do ambiente e nunca é impressa. Nenhuma função
 * privilegiada é criada no banco para esta bancada.
 */

const URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"]!;
const ANON =
  process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;

export const TEST_DOMAIN = "@lardan.test";
export const TEST_PASSWORD = "Homolog#2026!Lardan";
/** Prefixo obrigatório de todo dado sintético criado por esta bancada. */
export const TEST_PREFIX = "HOMOLOG";

export type Papel =
  | "master"
  | "diretoria"
  | "financeiro"
  | "estoque"
  | "marketing"
  | "suporte"
  | "cobranca"
  | "montagem"
  | "qualidade"
  | "representante"
  | "consultora";

export interface Conta {
  nome: string;
  email: string;
  userId: string;
  token: string | null;
  papeis: Papel[];
  ativo: boolean;
  partyId: string | null;
}

async function req(
  path: string,
  init: RequestInit,
  key: string,
  bearer?: string | null,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: key,
      ...(bearer === undefined ? { Authorization: `Bearer ${key}` } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  let body: unknown = texto;
  try {
    body = JSON.parse(texto);
  } catch {
    /* resposta sem JSON */
  }
  return { status: res.status, body };
}

/** Chamada privilegiada (bypassa RLS) — só usada para montar/desmontar o cenário. */
const adm = (path: string, init: RequestInit = {}) => req(path, init, SERVICE);

/** Chamada como um papel (ou como visitante, quando token = null). */
export const comoUsuario = (token: string | null, path: string, init: RequestInit = {}) =>
  req(`/rest/v1${path}`, init, ANON, token);

export const rpc = (token: string | null, nome: string, args: Record<string, unknown> = {}) =>
  comoUsuario(token, `/rpc/${nome}`, { method: "POST", body: JSON.stringify(args) });

async function acharUsuario(email: string): Promise<string | null> {
  const r = await adm(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = (r.body as { users?: { id: string; email: string }[] }).users ?? [];
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

/** Cria uma pessoa sintética (prefixo HOMOLOG) e devolve o id. */
export async function criarPartySintetica(rotulo: string): Promise<string | null> {
  const r = await adm(`/rest/v1/parties`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      kind: "pessoa",
      display_name: `${TEST_PREFIX} ${rotulo}`,
      legal_name: `${TEST_PREFIX} ${rotulo}`,
      status: "ativo",
    }),
  });
  const linhas = Array.isArray(r.body) ? (r.body as { id: string }[]) : [];
  return linhas[0]?.id ?? null;
}

export async function criarConta(opts: {
  nome: string;
  papeis: Papel[];
  ativo?: boolean;
  comParty?: boolean;
}): Promise<Conta> {
  const email = `homolog.${opts.nome}${TEST_DOMAIN}`;
  let userId = await acharUsuario(email);
  if (!userId) {
    const r = await adm(`/auth/v1/admin/users`, {
      method: "POST",
      body: JSON.stringify({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { homologacao: true, full_name: `${TEST_PREFIX} ${opts.nome}` },
      }),
    });
    userId = (r.body as { id?: string }).id ?? null;
    if (!userId) throw new Error(`falha ao criar ${email}: ${JSON.stringify(r.body)}`);
  }

  const ativo = opts.ativo ?? true;
  const partyId = opts.comParty ? await criarPartySintetica(opts.nome) : null;

  await adm(`/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: userId,
      full_name: `${TEST_PREFIX} ${opts.nome}`,
      email,
      is_active: ativo,
      party_id: partyId,
    }),
  });
  await adm(`/rest/v1/user_roles?user_id=eq.${userId}`, { method: "DELETE" });
  for (const papel of opts.papeis) {
    await adm(`/rest/v1/user_roles`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role: papel }),
    });
  }

  const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const sessao = (await login.json()) as { access_token?: string };

  return {
    nome: opts.nome,
    email,
    userId,
    token: sessao.access_token ?? null,
    papeis: opts.papeis,
    ativo,
    partyId,
  };
}

/** Remove as contas e as pessoas sintéticas ao fim da bateria. */
export async function limpar() {
  const r = await adm(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = (r.body as { users?: { id: string; email: string }[] }).users ?? [];
  for (const u of users) {
    if (u.email?.endsWith(TEST_DOMAIN)) {
      await adm(`/rest/v1/user_roles?user_id=eq.${u.id}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false, party_id: null }),
      });
      await adm(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    }
  }
  await adm(`/rest/v1/parties?display_name=like.${TEST_PREFIX}%25`, { method: "DELETE" });
}

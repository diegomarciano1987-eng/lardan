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

export type Papel =
  | "master"
  | "diretoria"
  | "financeiro"
  | "estoque"
  | "marketing"
  | "suporte"
  | "representante"
  | "consultora";

export interface Conta {
  nome: string;
  email: string;
  userId: string;
  token: string | null;
  papel: Papel | null;
  ativo: boolean;
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

export async function criarConta(opts: {
  nome: string;
  papel: Papel | null;
  ativo?: boolean;
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
        user_metadata: { homologacao: true, full_name: `HOMOLOG ${opts.nome}` },
      }),
    });
    userId = (r.body as { id?: string }).id ?? null;
    if (!userId) throw new Error(`falha ao criar ${email}: ${JSON.stringify(r.body)}`);
  }

  const ativo = opts.ativo ?? true;
  await adm(`/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: userId, full_name: `HOMOLOG ${opts.nome}`, email, is_active: ativo }),
  });
  await adm(`/rest/v1/user_roles?user_id=eq.${userId}`, { method: "DELETE" });
  if (opts.papel) {
    await adm(`/rest/v1/user_roles`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role: opts.papel }),
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
    papel: opts.papel,
    ativo,
  };
}

/** Remove as contas sintéticas ao fim da bateria. */
export async function limpar() {
  const r = await adm(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = (r.body as { users?: { id: string; email: string }[] }).users ?? [];
  for (const u of users) {
    if (u.email?.endsWith(TEST_DOMAIN)) {
      await adm(`/rest/v1/user_roles?user_id=eq.${u.id}`, { method: "DELETE" });
      await adm(`/rest/v1/profiles?id=eq.${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: false }),
      });
      await adm(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    }
  }
}

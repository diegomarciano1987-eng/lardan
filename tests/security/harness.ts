/**
 * Bancada de homologação de segurança do LARDAN Cloud.
 *
 * Cria (ou reaproveita) contas sintéticas de teste — uma por papel — e devolve
 * um cliente REST autenticado para cada uma. Nenhum usuário real é tocado:
 * todas as contas usam o domínio @lardan.test e o prefixo `homolog`.
 *
 * A chave de serviço é lida do ambiente e nunca é impressa.
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

function admHeaders() {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
}

async function adminRequest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: { ...admHeaders(), ...(init.headers ?? {}) },
  });
  const texto = await res.text();
  let corpo: unknown = texto;
  try {
    corpo = JSON.parse(texto);
  } catch {
    /* resposta sem JSON */
  }
  return { status: res.status, body: corpo as Record<string, unknown> };
}

/** Executa SQL privilegiado através da RPC de homologação. */
export async function sqlAdmin(sql: string) {
  return adminRequest(`/rest/v1/rpc/homolog_exec`, {
    method: "POST",
    body: JSON.stringify({ _sql: sql }),
  });
}

async function acharUsuario(email: string): Promise<string | null> {
  const r = await adminRequest(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = (r.body as { users?: { id: string; email: string }[] }).users ?? [];
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

export async function criarConta(opts: {
  nome: string;
  papel: Papel | null;
  ativo?: boolean;
  comParty?: boolean;
}): Promise<Conta> {
  const email = `homolog.${opts.nome}${TEST_DOMAIN}`;
  let userId = await acharUsuario(email);
  if (!userId) {
    const r = await adminRequest(`/auth/v1/admin/users`, {
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
  await sqlAdmin(`
    insert into public.profiles (id, full_name, email, is_active)
    values ('${userId}', 'HOMOLOG ${opts.nome}', '${email}', ${ativo})
    on conflict (id) do update set is_active = ${ativo}, full_name = excluded.full_name;
    delete from public.user_roles where user_id = '${userId}';
    ${opts.papel ? `insert into public.user_roles (user_id, role) values ('${userId}', '${opts.papel}');` : ""}
  `);

  if (opts.comParty) {
    await sqlAdmin(`
      with p as (
        insert into public.parties (kind, code, display_name, status, is_active)
        values ('pessoa', 'HOMOLOG-${opts.nome.toUpperCase()}', 'HOMOLOG ${opts.nome}', 'ativo', true)
        on conflict (code) do update set display_name = excluded.display_name
        returning id
      )
      update public.profiles set party_id = (select id from p) where id = '${userId}';
    `);
  } else {
    await sqlAdmin(`update public.profiles set party_id = null where id = '${userId}';`);
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

/** Chamada REST como um papel (ou como visitante, quando token = null). */
export async function comoUsuario(
  token: string | null,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const texto = await res.text();
  let body: unknown = texto;
  try {
    body = JSON.parse(texto);
  } catch {
    /* sem JSON */
  }
  return { status: res.status, body };
}

export const rpc = (token: string | null, nome: string, args: Record<string, unknown> = {}) =>
  comoUsuario(token, `/rpc/${nome}`, { method: "POST", body: JSON.stringify(args) });

/** Remove as contas sintéticas, preservando auditoria. */
export async function limpar() {
  const r = await adminRequest(`/auth/v1/admin/users?page=1&per_page=200`);
  const users = (r.body as { users?: { id: string; email: string }[] }).users ?? [];
  for (const u of users) {
    if (u.email?.endsWith(TEST_DOMAIN)) {
      await sqlAdmin(`delete from public.user_roles where user_id = '${u.id}';
                      update public.profiles set is_active = false where id = '${u.id}';`);
      await adminRequest(`/auth/v1/admin/users/${u.id}`, { method: "DELETE" });
    }
  }
  await sqlAdmin(`delete from public.parties where code like 'HOMOLOG-%';`);
}

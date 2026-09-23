/**
 * Gateway LOCAL da segunda instância isolada.
 *
 * Expõe, na porta 54321, o formato que o cliente da aplicação espera:
 *   /rest/v1/*  → PostgREST local (54330), ligado só ao banco isolado
 *   /auth/v1/*  → autenticação mínima para usuários SINTÉTICOS do banco isolado
 *
 * Não há credencial real aqui: o segredo de assinatura é local, público neste
 * arquivo, e só vale para o Postgres descartável em 127.0.0.1:55432.
 */
import { SQL } from "bun";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SEGREDO_LOCAL = "lardan-isolado-segredo-local-nao-e-credencial-0001";
const PORTA = Number(process.env["GATEWAY_PORT"] ?? 54321);
const REST = process.env["POSTGREST_URL"] ?? "http://127.0.0.1:54330";
const SENHA_DEMO = "iso-demo"; // só vale para contas marcadas como sintéticas
const db = new SQL(process.env["LARDAN_ISO_URL"] ?? "postgresql://postgres@127.0.0.1:55432/lardan_iso?sslmode=disable", { max: 3 });

const b64 = (s: Buffer | string) => Buffer.from(s).toString("base64url");
export function assinar(payload: Record<string, unknown>) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify(payload));
  const s = createHmac("sha256", SEGREDO_LOCAL).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verificar(token: string): Record<string, unknown> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const esperado = createHmac("sha256", SEGREDO_LOCAL).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(s), b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (typeof claims.exp === "number" && claims.exp < Date.now() / 1000) return null;
  return claims;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range, content-profile, x-total-count",
};
const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { ...CORS, "content-type": "application/json" } });

async function usuario(id: string) {
  const [u] = (await db.unsafe(
    `select id, email, raw_user_meta_data, created_at from auth.users
      where id = $1 and banned_until is null and (raw_user_meta_data->>'sintetico')::boolean`,
    [id],
  )) as { id: string; email: string; raw_user_meta_data: unknown; created_at: string }[];
  if (!u) return null;
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.raw_user_meta_data,
    created_at: u.created_at, updated_at: u.created_at, email_confirmed_at: u.created_at, identities: [],
  };
}

async function sessao(id: string) {
  const user = await usuario(id);
  if (!user) return null;
  const agora = Math.floor(Date.now() / 1000);
  const expires_in = 3600;
  const access_token = assinar({ sub: id, role: "authenticated", aud: "authenticated", email: user.email, iat: agora, exp: agora + expires_in, session_id: crypto.randomUUID() });
  return { access_token, token_type: "bearer", expires_in, expires_at: agora + expires_in, refresh_token: `iso.${id}`, user };
}

async function auth(req: Request, caminho: string) {
  const url = new URL(req.url);
  if (caminho === "/settings") return json({ external: { email: true }, disable_signup: true });
  if (caminho === "/.well-known/jwks.json") return json({ keys: [] });
  if (caminho === "/logout") return new Response(null, { status: 204, headers: CORS });
  if (caminho === "/user") {
    const t = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const c = verificar(t);
    if (!c || c["role"] !== "authenticated") return json({ code: 401, msg: "invalid JWT" }, 401);
    const u = await usuario(String(c["sub"]));
    return u ? json(u) : json({ code: 401, msg: "user not found" }, 401);
  }
  if (caminho === "/token") {
    const corpo = (await req.json().catch(() => ({}))) as Record<string, string>;
    const tipo = url.searchParams.get("grant_type");
    if (tipo === "password") {
      if (corpo["password"] !== SENHA_DEMO) return json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
      const [u] = (await db.unsafe(`select id from auth.users where lower(email) = lower($1)`, [corpo["email"] ?? ""])) as { id: string }[];
      const s = u ? await sessao(u.id) : null;
      return s ? json(s) : json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
    }
    if (tipo === "refresh_token") {
      const id = (corpo["refresh_token"] ?? "").replace(/^iso\./, "");
      const s = await sessao(id);
      return s ? json(s) : json({ error: "invalid_grant" }, 400);
    }
  }
  return json({ code: 404, msg: `auth local: ${caminho} não existe no ambiente isolado` }, 404);
}

Bun.serve({
  port: PORTA,
  hostname: "127.0.0.1",
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname.startsWith("/auth/v1")) return auth(req, url.pathname.slice("/auth/v1".length));
    if (url.pathname.startsWith("/rest/v1")) {
      const destino = REST + url.pathname.slice("/rest/v1".length) + url.search;
      const h = new Headers(req.headers);
      // o cliente manda a chave anônima como Bearer quando não há sessão
      if (!h.get("authorization")) h.set("authorization", `Bearer ${h.get("apikey") ?? ""}`);
      h.delete("host");
      const r = await fetch(destino, { method: req.method, headers: h, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
      const rh = new Headers(r.headers);
      for (const [k, v] of Object.entries(CORS)) rh.set(k, v);
      rh.delete("content-encoding");
      return new Response(await r.arrayBuffer(), { status: r.status, headers: rh });
    }
    return json({ msg: "gateway isolado LARDAN" });
  },
});
console.log(`gateway isolado em http://127.0.0.1:${PORTA}`);

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ORIGENS = [/^https:\/\/(www\.)?lardan\.com\.br$/, /^https:\/\/[a-z0-9-]+\.lovable\.app$/, /^http:\/\/localhost:\d+$/];
const origemSegura = (o: string) => (ORIGENS.some((r) => r.test(o)) ? o : "https://www.lardan.com.br");

async function novoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { token, hash: await hashToken(token) };
}
export async function hashToken(token: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enviar(email: string, nome: string, link: string, chave: string) {
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const expira = new Date(Date.now() + 48 * 3600e3).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const r = await sendTemplateEmail("convite-acesso", email, {
      templateData: { nome: nome.split(" ")[0], link, expira },
      idempotencyKey: chave,
    });
    return r.sent ? { ok: true, erro: "" } : { ok: false, erro: "E-mail bloqueado pelo destinatário (descadastro ou devolução)." };
  } catch (e) {
    return { ok: false, erro: (e instanceof Error ? e.message : "falha desconhecida").slice(0, 200) };
  }
}

type Papel = "master" | "diretoria" | "marketing" | "suporte" | "financeiro" | "cobranca" | "estoque" | "montagem" | "qualidade" | "representante" | "consultora";

/** Salva o conjunto completo de acessos de um colaborador em uma única operação auditada. */
export const substituirPapeis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; roles: Papel[] }) => {
    if (!/^[0-9a-f-]{36}$/.test(i.user_id)) throw new Error("Colaborador inválido.");
    if (!Array.isArray(i.roles) || i.roles.length > 11) throw new Error("Acessos inválidos.");
    return { user_id: i.user_id, roles: [...new Set(i.roles)] };
  })
  .handler(async ({ data, context }) => {
    const { data: master } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "master",
    });
    if (!master) throw new Error("Somente o Master pode editar acessos.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin.rpc("access_roles_replace_admin" as never, {
      _user_id: data.user_id,
      _roles: data.roles,
      _actor_id: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return (roles ?? []) as Papel[];
  });

export const criarConvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { party_id: string; email: string; roles: Papel[]; origem: string }) => {
    if (!/^[0-9a-f-]{36}$/.test(i.party_id)) throw new Error("Cadastro inválido.");
    if (!Array.isArray(i.roles) || i.roles.length === 0 || i.roles.length > 5) throw new Error("Papéis inválidos.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { token, hash } = await novoToken();
    const { data: r, error } = await context.supabase.rpc("access_invite_create" as never, {
      _party: data.party_id, _email: data.email, _roles: data.roles, _token_hash: hash,
    } as never);
    if (error) throw new Error(error.message);
    const res = r as unknown as { ok: boolean; id?: string; conflito?: string };
    if (!res.ok) return { ok: false as const, conflito: res.conflito ?? "Conflito." };
    const { data: p } = await context.supabase.from("parties").select("display_name").eq("id", data.party_id).maybeSingle();
    const link = `${origemSegura(data.origem)}/convite/${token}`;
    const env = await enviar(data.email.trim().toLowerCase(), (p as { display_name?: string } | null)?.display_name ?? "", link, `convite-${res.id}-1`);
    await context.supabase.rpc("access_invite_envio" as never, { _id: res.id, _ok: env.ok, _erro: env.erro } as never);
    return { ok: true as const, id: res.id!, link, enviado: env.ok, erro: env.erro };
  });

export const reenviarConvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string; origem: string }) => {
    if (!/^[0-9a-f-]{36}$/.test(i.id)) throw new Error("Convite inválido.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { token, hash } = await novoToken();
    const { data: r, error } = await context.supabase.rpc("access_invite_resend" as never, { _id: data.id, _token_hash: hash } as never);
    if (error) throw new Error(error.message);
    const res = r as unknown as { email: string };
    const { data: inv } = await context.supabase.from("access_invites" as never).select("envios, parties(display_name)").eq("id", data.id).maybeSingle();
    const x = inv as unknown as { envios: number; parties: { display_name: string } | null } | null;
    const link = `${origemSegura(data.origem)}/convite/${token}`;
    const env = await enviar(res.email, x?.parties?.display_name ?? "", link, `convite-${data.id}-${(x?.envios ?? 0) + 1}`);
    await context.supabase.rpc("access_invite_envio" as never, { _id: data.id, _ok: env.ok, _erro: env.erro } as never);
    return { link, enviado: env.ok, erro: env.erro };
  });

/** Consulta pública pelo link: devolve só situação, primeiro nome e e-mail mascarado. */
export const consultarConvite = createServerFn({ method: "POST" })
  .inputValidator((i: { token: string }) => {
    if (!/^[0-9a-f]{64}$/.test(i.token)) throw new Error("Convite inválido.");
    return i;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r, error } = await supabaseAdmin.rpc("access_invite_preview" as never, { _token_hash: await hashToken(data.token) } as never);
    if (error) throw new Error("Não foi possível consultar o convite.");
    return r as unknown as { situacao: string; nome?: string; email_mascarado?: string; papeis?: string[]; expira?: string };
  });

export const aceitarConvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { token: string }) => {
    if (!/^[0-9a-f]{64}$/.test(i.token)) throw new Error("Convite inválido.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("access_invite_accept" as never, { _token_hash: await hashToken(data.token) } as never);
    if (error) throw new Error(error.message);
    return r as unknown as { ok: boolean; erro?: string; papeis?: string[]; repetido?: boolean };
  });

/** Recuperação auditada: só Master (com segundo fator), com motivo. */
export const removerAutenticador = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; motivo: string }) => {
    if (!/^[0-9a-f-]{36}$/.test(i.user_id) || (i.motivo ?? "").trim().length < 5) throw new Error("Dados inválidos.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_role" as never, { _user_id: context.userId, _role: "master" } as never);
    if (!ok) throw new Error("Somente o Master.");
    const aal = (context.claims as { aal?: string }).aal;
    if (aal !== "aal2" && data.user_id !== context.userId) throw new Error("Entre com seu autenticador antes de recuperar o de outra pessoa.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: f, error } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId: data.user_id });
    if (error) throw new Error(error.message);
    for (const fator of f.factors) {
      const { error: e2 } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId: data.user_id, id: fator.id });
      if (e2) throw new Error(e2.message);
    }
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId, action: "access.mfa.recuperar", entity: "auth.mfa_factors", entity_id: data.user_id,
      payload: { motivo: data.motivo, fatores: f.factors.length },
    } as never);
    return { removidos: f.factors.length };
  });

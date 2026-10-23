import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ERRO_LOGIN = "Não foi possível entrar. Confira o código e a senha.";
const MAX_FALHAS = 5;
const BLOQUEIO_MIN = 15;

const codigoOk = (c: unknown) => typeof c === "string" && /^[0-9]{3,8}$/.test(c.trim());
const uuidOk = (u: unknown) => typeof u === "string" && /^[0-9a-f-]{36}$/.test(u);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function exigirMaster(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "master" });
  if (!data) throw new Error("Somente o Master pode cuidar dos acessos das colaboradoras.");
}

/** Entrada da porta Operação por código da colaboradora + senha (sem e-mail). */
export const entrarPorCodigo = createServerFn({ method: "POST" })
  .inputValidator((i: { codigo: string; senha: string }) => {
    if (!codigoOk(i?.codigo) || typeof i?.senha !== "string" || i.senha.length < 1 || i.senha.length > 128)
      throw new Error(ERRO_LOGIN);
    return { codigo: i.codigo.trim(), senha: i.senha };
  })
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: ac } = await sb
      .from("colab_acessos")
      .select("user_id, ativo, falhas, bloqueado_ate")
      .eq("codigo", data.codigo)
      .maybeSingle();
    if (!ac || !ac.ativo) throw new Error(ERRO_LOGIN);
    if (ac.bloqueado_ate && new Date(ac.bloqueado_ate) > new Date())
      throw new Error(`Muitas tentativas erradas. Aguarde ${BLOQUEIO_MIN} minutos ou peça ao Daniel para liberar.`);

    const { data: u } = await sb.auth.admin.getUserById(ac.user_id);
    const email = u?.user?.email;
    if (!email) throw new Error(ERRO_LOGIN);

    const { createClient } = await import("@supabase/supabase-js");
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const pub = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: s, error } = await pub.auth.signInWithPassword({ email, password: data.senha });
    if (error || !s.session) {
      const falhas = (ac.falhas ?? 0) + 1;
      await sb
        .from("colab_acessos")
        .update({
          falhas: falhas >= MAX_FALHAS ? 0 : falhas,
          bloqueado_ate: falhas >= MAX_FALHAS ? new Date(Date.now() + BLOQUEIO_MIN * 60e3).toISOString() : null,
        })
        .eq("user_id", ac.user_id);
      throw new Error(ERRO_LOGIN);
    }
    await sb.from("colab_acessos").update({ falhas: 0, bloqueado_ate: null }).eq("user_id", ac.user_id);
    await sb.from("audit_logs").insert({
      actor_id: ac.user_id, action: "colab.login.codigo", entity: "colab_acessos", entity_id: ac.user_id, payload: {},
    } as never);
    return { access_token: s.session.access_token, refresh_token: s.session.refresh_token };
  });

export type ColabAcesso = {
  ehColaboradora: boolean;
  proximo: string;
  acesso: null | { user_id: string; codigo: string; ativo: boolean; bloqueado: boolean; email_real: boolean };
  caps: string[];
  financeiro: boolean;
};

export const colabAcessoLer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { party_id: string }) => {
    if (!uuidOk(i?.party_id)) throw new Error("Cadastro inválido.");
    return i;
  })
  .handler(async ({ data, context }): Promise<ColabAcesso> => {
    await exigirMaster(context);
    const sb = await admin();
    const [{ data: papel }, { data: ac }, { data: prox }, { data: perfil }] = await Promise.all([
      sb.from("party_roles").select("id").eq("party_id", data.party_id).eq("role", "colaborador").is("ended_at", null).limit(1),
      sb.from("colab_acessos").select("user_id, codigo, ativo, bloqueado_ate").eq("party_id", data.party_id).maybeSingle(),
      sb.rpc("colab_proximo_codigo" as never),
      sb.from("profiles").select("id, email").eq("party_id", data.party_id).limit(1).maybeSingle(),
    ]);
    let caps: string[] = [];
    let financeiro = false;
    const uid = ac?.user_id ?? perfil?.id;
    if (uid) {
      const [{ data: c }, { data: f }] = await Promise.all([
        sb.from("user_capabilities").select("capability").eq("user_id", uid),
        sb.from("user_financial_access" as never).select("enabled").eq("user_id", uid).maybeSingle(),
      ]);
      caps = (c ?? []).map((r: { capability: string }) => r.capability);
      financeiro = Boolean((f as { enabled?: boolean } | null)?.enabled);
    }
    return {
      ehColaboradora: (papel ?? []).length > 0,
      proximo: String(prox ?? "1001"),
      acesso: ac
        ? {
            user_id: ac.user_id,
            codigo: ac.codigo,
            ativo: ac.ativo,
            bloqueado: Boolean(ac.bloqueado_ate && new Date(ac.bloqueado_ate) > new Date()),
            email_real: Boolean(perfil?.email && !perfil.email.endsWith("@acesso.lardan.com.br")),
          }
        : null,
      caps,
      financeiro,
    };
  });

/** Cria ou atualiza o código e a senha da colaboradora (somente Master). */
export const colabAcessoSalvar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { party_id: string; codigo: string; senha?: string }) => {
    if (!uuidOk(i?.party_id)) throw new Error("Cadastro inválido.");
    if (!codigoOk(i?.codigo)) throw new Error("O código precisa ter de 3 a 8 números.");
    if (i.senha !== undefined && i.senha !== "" && (i.senha.length < 8 || i.senha.length > 72))
      throw new Error("A senha precisa ter pelo menos 8 caracteres.");
    return { party_id: i.party_id, codigo: i.codigo.trim(), senha: i.senha || undefined };
  })
  .handler(async ({ data, context }) => {
    await exigirMaster(context);
    const sb = await admin();
    const { data: ac } = await sb.from("colab_acessos").select("user_id").eq("party_id", data.party_id).maybeSingle();
    const { data: perfil } = await sb.from("profiles").select("id").eq("party_id", data.party_id).limit(1).maybeSingle();
    let userId = ac?.user_id ?? perfil?.id ?? null;
    let criado = false;

    if (!userId) {
      if (!data.senha) throw new Error("Defina uma senha para o primeiro acesso.");
      const { data: party } = await sb.from("parties").select("display_name, legal_name").eq("id", data.party_id).maybeSingle();
      if (!party) throw new Error("Cadastro não encontrado.");
      const nome = party.display_name ?? party.legal_name ?? "Colaboradora";
      const email = `colab-${data.codigo}@acesso.lardan.com.br`;
      const { data: novo, error } = await sb.auth.admin.createUser({
        email, password: data.senha, email_confirm: true, user_metadata: { full_name: nome },
      });
      if (error || !novo.user) throw new Error("Não foi possível criar o acesso: " + (error?.message ?? "erro"));
      userId = novo.user.id;
      criado = true;
      const { error: pe } = await sb.from("profiles").upsert({
        id: userId, full_name: nome, email, party_id: data.party_id, is_active: true,
      } as never);
      if (pe) {
        await sb.auth.admin.deleteUser(userId);
        throw new Error("Não foi possível criar o perfil: " + pe.message);
      }
    } else if (data.senha) {
      const { error } = await sb.auth.admin.updateUserById(userId, { password: data.senha });
      if (error) throw new Error("Não foi possível trocar a senha: " + error.message);
    }

    const { error: re } = await sb.rpc("colab_acesso_registrar" as never, {
      _user_id: userId, _party_id: data.party_id, _codigo: data.codigo, _actor: context.userId,
    } as never);
    if (re) {
      if (criado) await sb.auth.admin.deleteUser(userId);
      throw new Error(re.message);
    }
    if (data.senha) {
      await sb.from("audit_logs").insert({
        actor_id: context.userId, action: "colab.senha.definir", entity: "colab_acessos", entity_id: userId, payload: { criado },
      } as never);
    }
    return { ok: true, user_id: userId };
  });

export const colabModulosSalvar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; caps: string[]; financeiro: boolean }) => {
    if (!uuidOk(i?.user_id)) throw new Error("Colaboradora inválida.");
    if (!Array.isArray(i.caps) || i.caps.length > 80) throw new Error("Módulos inválidos.");
    return { user_id: i.user_id, caps: [...new Set(i.caps.map(String))], financeiro: Boolean(i.financeiro) };
  })
  .handler(async ({ data, context }) => {
    await exigirMaster(context);
    const sb = await admin();
    const { data: r, error } = await sb.rpc("colab_modulos_definir" as never, {
      _user_id: data.user_id, _caps: data.caps, _financeiro: data.financeiro, _actor: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return (r ?? []) as string[];
  });

export const colabAcessoAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; ativo: boolean }) => {
    if (!uuidOk(i?.user_id)) throw new Error("Colaboradora inválida.");
    return { user_id: i.user_id, ativo: Boolean(i.ativo) };
  })
  .handler(async ({ data, context }) => {
    await exigirMaster(context);
    const sb = await admin();
    const { error } = await sb.rpc("colab_acesso_ativo_definir" as never, {
      _user_id: data.user_id, _ativo: data.ativo, _actor: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

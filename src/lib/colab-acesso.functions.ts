import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { traduzirErroSenha } from "@/lib/senha-forte";

const ERRO_LOGIN =
  "Não foi possível entrar. Confira o código e a senha. Depois de 5 tentativas erradas o acesso fica travado por 15 minutos.";

const codigoOk = (c: unknown) => typeof c === "string" && /^[0-9]{3,8}$/.test(c.trim());
/** 0372: nome de acesso tudo junto (ex.: ketllindesouza). */
export const usuarioOk = (u: unknown) => typeof u === "string" && /^[a-z][a-z0-9]{3,29}$/.test(u.trim().toLowerCase());
const loginOk = (c: unknown) => codigoOk(c) || usuarioOk(c);
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
    if (!loginOk(i?.codigo) || typeof i?.senha !== "string" || i.senha.length < 1 || i.senha.length > 128)
      throw new Error(ERRO_LOGIN);
    return { codigo: i.codigo.trim().toLowerCase(), senha: i.senha };
  })
  .handler(async ({ data }) => {
    const sb = await admin();
    // 0326: limite por aparelho/rede antes de gastar as 5 tentativas do código (evita travar a equipe toda e chute de senha)
    const { ipCliente, exigirLimites } = await import("./seguranca/limite.server");
    const ip = ipCliente();
    await exigirLimites([[ip ? `login-colab:ip:${ip}` : null, 20, 900]], ERRO_LOGIN);
    // 0136: a tentativa é reservada no banco de forma atômica (5 erradas travam 15 min, mesmo em paralelo).
    // Código inexistente, suspenso, travado ou de conta da equipe: mesma resposta, sem dizer qual.
    const { data: reservado, error: re } = await sb.rpc("colab_login_reservar" as never, { _codigo: data.codigo } as never);
    const userId = re ? null : (reservado as unknown as string | null);
    if (!userId) throw new Error(ERRO_LOGIN);

    const { data: u } = await sb.auth.admin.getUserById(userId);
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
    if (error || !s.session) throw new Error(ERRO_LOGIN);
    await sb.rpc("colab_login_ok" as never, { _user: userId } as never);
    return { access_token: s.session.access_token, refresh_token: s.session.refresh_token };
  });

/** 0372: mostra o par código <-> nome de acesso enquanto ela digita (sem nome, sem situação da conta). */
export const colabLoginPar = createServerFn({ method: "POST" })
  .inputValidator((i: { t: string }) => {
    if (!loginOk(i?.t)) return { t: "" };
    return { t: i.t.trim().toLowerCase() };
  })
  .handler(async ({ data }): Promise<{ codigo: string; usuario: string | null } | null> => {
    if (!data.t) return null;
    const { ipCliente, exigirLimites } = await import("./seguranca/limite.server");
    const ip = ipCliente();
    await exigirLimites([[ip ? `login-colab-par:ip:${ip}` : null, 120, 900]], "Aguarde um pouco e tente de novo.");
    const sb = await admin();
    const { data: r } = await sb.rpc("colab_login_par" as never, { _t: data.t } as never);
    return (r as unknown as { codigo: string; usuario: string | null } | null) ?? null;
  });

export type ColabAcesso = {
  ehColaboradora: boolean;
  proximo: string;
  acesso: null | { user_id: string; codigo: string; usuario: string | null; ativo: boolean; bloqueado: boolean; email_real: boolean };
  sugestaoUsuario: string | null;
  caps: string[];
  financeiro: boolean;
  /** 0136: já tem login com e-mail próprio — a senha é dela, o Master só salva o código. */
  emailReal: boolean;
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
      sb.from("colab_acessos").select("user_id, codigo, usuario, ativo, bloqueado_ate").eq("party_id", data.party_id).maybeSingle(),
      sb.rpc("colab_proximo_codigo" as never),
      sb.from("profiles").select("id, email").eq("party_id", data.party_id).limit(1).maybeSingle(),
    ]);
    let caps: string[] = [];
    let financeiro = false;
    let sugestaoUsuario: string | null = (ac as { usuario?: string | null } | null)?.usuario ?? null;
    if (!sugestaoUsuario) {
      const { data: party } = await sb.from("parties").select("display_name, legal_name").eq("id", data.party_id).maybeSingle();
      const { data: sug } = await sb.rpc("colab_usuario_sugerir" as never, { _nome: party?.display_name ?? party?.legal_name ?? "", _user: ac?.user_id ?? null } as never);
      sugestaoUsuario = (sug as unknown as string | null) ?? null;
    }
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
            usuario: (ac as { usuario?: string | null }).usuario ?? null,
            ativo: ac.ativo,
            bloqueado: Boolean(ac.bloqueado_ate && new Date(ac.bloqueado_ate) > new Date()),
            email_real: Boolean(perfil?.email && !perfil.email.endsWith("@acesso.lardan.com.br")),
          }
        : null,
      sugestaoUsuario,
      caps,
      financeiro,
      emailReal: Boolean(perfil?.email && !perfil.email.endsWith("@acesso.lardan.com.br")),
    };
  });

/** Cria ou atualiza o código e a senha da colaboradora (somente Master). */
export const colabAcessoSalvar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { party_id: string; codigo: string; usuario?: string | undefined; senha?: string | undefined }) => {
    if (!uuidOk(i?.party_id)) throw new Error("Cadastro inválido.");
    if (!codigoOk(i?.codigo)) throw new Error("O código precisa ter de 3 a 8 números.");
    if (i.usuario && !usuarioOk(i.usuario))
      throw new Error("O nome de acesso precisa ter de 4 a 30 letras/números, tudo junto, sem espaço nem acento.");
    if (i.senha !== undefined && i.senha !== "" && (i.senha.length < 8 || i.senha.length > 72))
      throw new Error("A senha precisa ter pelo menos 8 caracteres.");
    return { party_id: i.party_id, codigo: i.codigo.trim(), usuario: i.usuario?.trim().toLowerCase() || undefined, senha: i.senha || undefined };
  })
  .handler(async ({ data, context }) => {
    await exigirMaster(context);
    const sb = await admin();
    const { data: ac } = await sb.from("colab_acessos").select("user_id").eq("party_id", data.party_id).maybeSingle();
    const { data: perfil } = await sb.from("profiles").select("id, email").eq("party_id", data.party_id).limit(1).maybeSingle();
    let userId = ac?.user_id ?? perfil?.id ?? null;
    // 0136: quem já entra com e-mail próprio troca a senha por "Esqueci minha senha", nunca pelo Master.
    const emailReal = Boolean(perfil?.email && !perfil.email.endsWith("@acesso.lardan.com.br"));
    if (userId && emailReal && data.senha)
      throw new Error("Esta pessoa já entra com o próprio e-mail: a senha é dela. Salve só o código; ela usa a mesma senha do e-mail.");
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
      if (error || !novo.user) throw new Error("Não foi possível criar o acesso: " + traduzirErroSenha(error?.message ?? "erro"));
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
      if (error) throw new Error("Não foi possível trocar a senha: " + traduzirErroSenha(error.message));
    }

    const { error: re } = await sb.rpc("colab_acesso_registrar" as never, {
      _user_id: userId, _party_id: data.party_id, _codigo: data.codigo, _actor: context.userId,
    } as never);
    if (re) {
      if (criado) await sb.auth.admin.deleteUser(userId);
      throw new Error(re.message);
    }
    // 0372: nome de acesso (escolhido ou sugerido pelo nome dela)
    let usuario = data.usuario;
    if (!usuario) {
      const { data: atual } = await sb.from("colab_acessos").select("usuario").eq("user_id", userId).maybeSingle();
      if (!(atual as { usuario?: string | null } | null)?.usuario) {
        const { data: party } = await sb.from("parties").select("display_name, legal_name").eq("id", data.party_id).maybeSingle();
        const { data: sug } = await sb.rpc("colab_usuario_sugerir" as never, { _nome: party?.display_name ?? party?.legal_name ?? "", _user: userId } as never);
        usuario = (sug as unknown as string | null) ?? undefined;
      }
    }
    if (usuario) {
      const { error: ue } = await sb.rpc("colab_acesso_usuario_definir" as never, { _user_id: userId, _usuario: usuario, _actor: context.userId } as never);
      if (ue) throw new Error(ue.message);
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

export type ColabEscopo = {
  user_id: string | null;
  rede_toda: boolean;
  qualidade: boolean;
  representantes: string[];
  pracas: string[];
  representantePrincipal: { id: string; nome: string } | null;
  opcoesReps: { id: string; nome: string }[];
  opcoesPracas: { id: string; nome: string; codigo: string | null }[];
};

/** 0372: o que a colaboradora pode ver (toda a rede, representantes, praças). Só o Master. */
export const colabEscopoLer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { party_id: string }) => {
    if (!uuidOk(i?.party_id)) throw new Error("Cadastro inválido.");
    return i;
  })
  .handler(async ({ data, context }): Promise<ColabEscopo> => {
    await exigirMaster(context);
    const sb = await admin();
    const [{ data: ac }, { data: cp }, { data: reps }, { data: pracas }] = await Promise.all([
      sb.from("colab_acessos").select("user_id").eq("party_id", data.party_id).maybeSingle(),
      sb.from("consultant_profiles").select("representative_party_id").eq("party_id", data.party_id).maybeSingle(),
      sb.from("party_roles").select("party_id, parties!inner(display_name, legal_name)").eq("role", "representante").is("ended_at", null).limit(500),
      sb.from("cob_pracas").select("id, nome, codigo, ativo").order("nome").limit(1000),
    ]);
    const uid = ac?.user_id ?? null;
    type Esc = { rede_toda: boolean; representantes: string[]; pracas: string[] };
    let e = null as Esc | null;
    let qualidade = false;
    if (uid) {
      const [{ data: es }, { data: q }] = await Promise.all([
        sb.from("colab_escopos" as never).select("rede_toda, representantes, pracas").eq("user_id", uid).maybeSingle(),
        sb.from("user_capabilities").select("capability").eq("user_id", uid).eq("capability", "quality.manage").limit(1),
      ]);
      e = es as unknown as Esc | null;
      qualidade = (q ?? []).length > 0;
    }
    const nomeDe = (r: { parties: { display_name: string | null; legal_name: string | null } | null }) =>
      r.parties?.display_name ?? r.parties?.legal_name ?? "Representante";
    const opcoesReps = [...new Map(((reps ?? []) as never as { party_id: string; parties: { display_name: string | null; legal_name: string | null } }[])
      .map((r) => [r.party_id, { id: r.party_id, nome: nomeDe(r) }])).values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const repId = (cp as { representative_party_id?: string | null } | null)?.representative_party_id ?? null;
    return {
      user_id: uid,
      rede_toda: Boolean(e?.rede_toda),
      qualidade,
      representantes: e?.representantes ?? [],
      pracas: e?.pracas ?? [],
      representantePrincipal: repId ? { id: repId, nome: opcoesReps.find((r) => r.id === repId)?.nome ?? "Representante" } : null,
      opcoesReps,
      opcoesPracas: (pracas ?? [])
        .filter((p) => p.ativo !== false).map((p) => ({ id: p.id, nome: p.nome, codigo: p.codigo == null ? null : String(p.codigo) })),
    };
  });

export const colabEscopoSalvar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; rede_toda: boolean; representantes: string[]; pracas: string[] }) => {
    if (!uuidOk(i?.user_id)) throw new Error("Colaboradora inválida.");
    if (!Array.isArray(i.representantes) || !Array.isArray(i.pracas) || !i.representantes.every(uuidOk) || !i.pracas.every(uuidOk))
      throw new Error("Escolha inválida.");
    return { user_id: i.user_id, rede_toda: Boolean(i.rede_toda), representantes: [...new Set(i.representantes)], pracas: [...new Set(i.pracas)] };
  })
  .handler(async ({ data, context }) => {
    await exigirMaster(context);
    const sb = await admin();
    const { error } = await sb.rpc("colab_escopo_definir" as never, {
      _user_id: data.user_id, _rede_toda: data.rede_toda, _reps: data.representantes, _pracas: data.pracas, _actor: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

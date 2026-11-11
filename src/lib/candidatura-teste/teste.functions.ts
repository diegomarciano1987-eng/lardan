/**
 * Teste de candidatura — servidor.
 * Link público /candidatura/<token>: o token (64 hex aleatórios) é a única chave; nada de dado pessoal além do primeiro nome.
 * Salva a cada tela (o mesmo link retoma) e calcula tudo aqui no servidor ao concluir.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DISC, FATORES, FRASES, ORGANIZACAO, PARTE1, RESTRICAO, SITE, type Fator, type RespostaDisc, type Respostas } from "./perguntas";
import { mesclarParametros, type ParametrosTeste } from "./padrao";
import { calcular } from "./calculo";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const Token = z.string().regex(/^[a-f0-9]{64}$/);
const cod = (lista: readonly { codigo: string }[]) => z.enum(lista.map((o) => o.codigo) as [string, ...string[]]);
const Fat = z.enum(["D", "I", "S", "C"]);

const Patch = z.object({
  experiencia_venda: cod(SITE.experiencia_venda.opcoes).optional(),
  horas_semana: cod(SITE.horas_semana.opcoes).optional(),
  local_trabalho: z.string().trim().min(2).max(200).optional(),
  contatos_semana: cod(PARTE1.contatos_semana.opcoes).optional(),
  publico_feminino: cod(PARTE1.publico_feminino.opcoes).optional(),
  onde_pretende_vender: z.array(cod(PARTE1.onde_pretende_vender.opcoes)).min(1).max(8).optional(),
  contatos_whatsapp: cod(PARTE1.contatos_whatsapp.opcoes).optional(),
  o1: cod(ORGANIZACAO[0]!.opcoes).optional(), o2: cod(ORGANIZACAO[1]!.opcoes).optional(),
  o3: cod(ORGANIZACAO[2]!.opcoes).optional(), o4: cod(ORGANIZACAO[3]!.opcoes).optional(),
  o5: cod(ORGANIZACAO[4]!.opcoes).optional(),
  restricao_declarada: cod(RESTRICAO.opcoes).optional(),
  frases: z.record(z.enum(FRASES.map((f) => f.id) as [string, ...string[]]), z.number().int().min(1).max(5)).optional(),
}).strict();

type Linha = {
  id: string; lead_id: string; parte: number; respostas: Respostas; disc_ordem: number[][] | null; disc_respostas: (RespostaDisc | null)[];
  disc_inicio: string | null; disc_fim: string | null; concluido_em: string | null; cancelado_em: string | null; expira_em: string;
  aceite_em: string | null; resultado: { disc_principal?: Fator } | null; rp_ajuste: boolean;
};

async function parametros(): Promise<ParametrosTeste> {
  const sb = await admin();
  const { data } = await sb.from("candidatura_teste_config").select("params").order("criado_em", { ascending: false }).limit(1).maybeSingle();
  return mesclarParametros((data?.params ?? null) as Partial<ParametrosTeste> | null);
}

async function carregar(token: string, paraEscrever: boolean): Promise<Linha> {
  const sb = await admin();
  const { data, error } = await sb.from("candidatura_testes").select("*").eq("token", token).maybeSingle();
  if (error) throw new Error("Não foi possível abrir o teste agora. Tente de novo em instantes.");
  const t = data as unknown as Linha | null;
  if (!t || t.cancelado_em) throw new Error("Este link não vale mais. Peça um novo pelo WhatsApp.");
  if (paraEscrever && t.concluido_em) throw new Error("Este teste já foi concluído. Obrigada!");
  if (!t.concluido_em && new Date(t.expira_em).getTime() < Date.now()) throw new Error("Este link venceu. Peça um novo pelo WhatsApp.");
  return t;
}

function embaralhar(): number[][] {
  return DISC.map(() => {
    const a = [0, 1, 2, 3];
    for (let i = a.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a;
  });
}

/** O que falta responder (todas obrigatórias na versão final). */
export function faltando(r: Respostas, disc: (RespostaDisc | null)[]): string[] {
  const f: string[] = [];
  if (!r.experiencia_venda) f.push("experiencia_venda");
  if (!r.horas_semana) f.push("horas_semana");
  if (!r.local_trabalho) f.push("local_trabalho");
  for (const k of ["contatos_semana", "publico_feminino", "contatos_whatsapp"] as const) if (!r[k]) f.push(k);
  if (!r.onde_pretende_vender?.length) f.push("onde_pretende_vender");
  for (const o of ORGANIZACAO) if (!r[o.id]) f.push(o.id);
  if (!r.restricao_declarada) f.push("restricao_declarada");
  for (const fr of FRASES) if (typeof r.frases?.[fr.id] !== "number") f.push(fr.id);
  DISC.forEach((_, i) => { const d = disc[i]; if (!d || d.mais === d.menos) f.push(`disc_${i + 1}`); });
  return f;
}

export const testeAbrir = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const t = await carregar(data.token, false);
    const { data: lead } = await sb.from("leads").select("first_name, full_name").eq("id", t.lead_id).maybeSingle();
    const nome = ((lead?.first_name ?? lead?.full_name ?? "").split(" ")[0] ?? "").trim();
    let ordem = t.disc_ordem;
    if (!t.concluido_em && !ordem) {
      ordem = embaralhar();
      await sb.from("candidatura_testes").update({ disc_ordem: ordem as never, atualizado_em: new Date().toISOString() }).eq("id", t.id);
    }
    let devolutiva: string | null = null;
    if (t.concluido_em && t.resultado?.disc_principal) {
      const p = await parametros();
      devolutiva = p.textos.devolutiva[t.resultado.disc_principal] || null;
    }
    return {
      nome, parte: t.parte, respostas: t.respostas ?? {}, disc_ordem: ordem ?? [], disc_respostas: t.disc_respostas ?? [],
      precisa_aceite: !t.aceite_em, concluido: !!t.concluido_em, devolutiva,
    };
  });

export const testeSalvar = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    token: Token,
    parte: z.number().int().min(1).max(4),
    respostas: Patch.default({}),
    aceite: z.string().max(400).optional(),
    disc: z.object({ grupo: z.number().int().min(0).max(DISC.length - 1), mais: Fat, menos: Fat }).refine((x) => x.mais !== x.menos).optional(),
    iniciarDisc: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const t = await carregar(data.token, true);
    const respostas: Respostas = { ...(t.respostas ?? {}), ...data.respostas, frases: { ...(t.respostas?.frases ?? {}), ...(data.respostas.frases ?? {}) } };
    const disc = [...(t.disc_respostas ?? [])];
    while (disc.length < DISC.length) disc.push(null);
    if (data.disc) disc[data.disc.grupo] = { mais: data.disc.mais, menos: data.disc.menos };
    const agora = new Date().toISOString();
    const upd: Record<string, unknown> = { respostas, disc_respostas: disc, parte: Math.max(t.parte, data.parte), atualizado_em: agora };
    if (data.aceite && !t.aceite_em) { upd["aceite_em"] = agora; upd["aceite_texto"] = data.aceite; }
    if (data.iniciarDisc && !t.disc_inicio) upd["disc_inicio"] = agora;
    const { error } = await sb.from("candidatura_testes").update(upd as never).eq("id", t.id).is("concluido_em", null);
    if (error) throw new Error("Não foi possível salvar. Confira a internet e tente de novo.");
    return { ok: true };
  });

export const testeConcluir = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const t = await carregar(data.token, true);
    if (!t.aceite_em) throw new Error("Falta marcar a autorização do início.");
    const falta = faltando(t.respostas ?? {}, t.disc_respostas ?? []);
    if (falta.length) throw new Error(`Ainda falta responder ${falta.length} pergunta(s).`);
    const p = await parametros();
    const fim = new Date().toISOString();
    const resultado = calcular(t.respostas, t.disc_respostas, p, { ajuste: t.rp_ajuste, discInicio: t.disc_inicio, discFim: fim });
    const { error } = await sb.from("candidatura_testes")
      .update({ disc_fim: fim, concluido_em: fim, resultado: resultado as never, versao_teste: p.versao, parte: 4, atualizado_em: fim })
      .eq("id", t.id).is("concluido_em", null);
    if (error) throw new Error("Não foi possível concluir. Tente de novo.");
    const { error: e2 } = await sb.rpc("candidatura_teste_concluido", { _teste: t.id });
    if (e2) console.error("[teste] pós-conclusão falhou:", e2.message);
    return { devolutiva: p.textos.devolutiva[resultado.disc_principal] || null };
  });

// ——— Equipe (com login) ———
async function exigirEdit(ctx: { supabase: { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_capability", { _user_id: ctx.userId, _cap: "candidaturas.edit" });
  if (data !== true) throw new Error("Sem permissão para alterar a análise.");
}

export const testeAjusteRede = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ teste: z.string().uuid(), aplicar: z.boolean(), motivo: z.string().trim().max(500).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    await exigirEdit(context as never);
    if (data.aplicar && data.motivo.length < 5) throw new Error("Escreva o motivo do ajuste (mínimo 5 letras).");
    const sb = await admin();
    const { data: t } = await sb.from("candidatura_testes").select("*").eq("id", data.teste).maybeSingle();
    const linha = t as unknown as (Linha & { versao_teste: string | null }) | null;
    if (!linha?.concluido_em) throw new Error("O teste ainda não foi concluído.");
    const p = await parametros();
    const resultado = calcular(linha.respostas, linha.disc_respostas, p, { ajuste: data.aplicar, discInicio: linha.disc_inicio, discFim: linha.disc_fim });
    const agora = new Date().toISOString();
    const { error } = await sb.from("candidatura_testes").update({
      rp_ajuste: data.aplicar, rp_ajuste_motivo: data.aplicar ? data.motivo : null, rp_ajuste_por: context.userId, rp_ajuste_em: agora,
      resultado: resultado as never, versao_teste: p.versao, atualizado_em: agora,
    }).eq("id", data.teste);
    if (error) throw new Error(error.message);
    await sb.rpc("crm_log", { _lead: linha.lead_id, _kind: "teste", _title: data.aplicar ? "Ajuste +15 na rede aplicado" : "Ajuste da rede retirado", _note: data.motivo || null, _meta: {}, _actor: context.userId } as never);
    return resultado;
  });

export const testeSerasa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ teste: z.string().uuid(), valor: z.enum(["sim", "nao"]).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await exigirEdit(context as never);
    const sb = await admin();
    const { error } = await sb.from("candidatura_testes").update({ serasa_confere: data.valor, atualizado_em: new Date().toISOString() }).eq("id", data.teste);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export { FATORES };

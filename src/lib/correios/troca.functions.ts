/**
 * Trocas e garantias pelos Correios (0251).
 *  • volta: código de postagem reversa (PAC reverso) para a consultora mandar a peça com defeito à Lardan;
 *  • ida: peça nova da Lardan para a consultora (PAC contrato), só com a troca em "Aguardando envio".
 * Regras e "um envio vivo por troca+direção" ficam no banco (qualidade_correios_*); o código vai sozinho
 * para a conversa da troca, que a consultora vê no app.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const DIR = ["volta", "ida"] as const;
type Direcao = (typeof DIR)[number];

async function servidor<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as { rpc: Rpc }).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function dados(c: Ctx, troca: string, direcao: Direcao) {
  const { data, error } = await c.supabase.rpc("qualidade_correios_dados", { _troca: troca, _direcao: direcao });
  if (error) throw new Error(error.message);
  return data as {
    destinatario: import("./api.server").EnderecoCorreios; remetente: import("./api.server").EnderecoCorreios;
    valor_declarado_cents: number; pendencias: string[]; envio_vivo: { id: string; status: string; codigo_objeto: string | null } | null;
  };
}

export const trocaCorreiosPrevia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { trocaId: string; direcao: Direcao }) => {
    if (!uuid(d?.trocaId) || !DIR.includes(d?.direcao)) throw new Error("Pedido inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const d = await dados(context as unknown as Ctx, data.trocaId, data.direcao);
    const api = await import("./api.server");
    return { ...d, configurado: api.configCorreios().pronto, ambiente: api.configCorreios().ambiente };
  });

export const trocaCorreiosEnviar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { trocaId: string; direcao: Direcao; juntar?: string[] }) => {
    if (!uuid(d?.trocaId) || !DIR.includes(d?.direcao)) throw new Error("Pedido inválido.");
    const juntar = [...new Set((d.juntar ?? []).filter((x) => x !== d.trocaId))];
    if (juntar.length > 9 || !juntar.every(uuid) || (juntar.length && d.direcao !== "ida")) throw new Error("Pedido inválido.");
    return { trocaId: d.trocaId, direcao: d.direcao, juntar };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const api = await import("./api.server");
    const cfg = api.configCorreios();
    if (!cfg.pronto) throw new Error(`Correios não configurado: falta ${cfg.faltando.join(", ")}.`);
    const d = await dados(c, data.trocaId, data.direcao);
    // trocas juntas no mesmo pacote: só da mesma consultora, sem envio de ida vivo
    const extras: { id: string; valor: number }[] = [];
    if (data.juntar.length) {
      const { data: ok, error } = await c.supabase.rpc("qualidade_trocas_juntaveis", { _troca: data.trocaId });
      if (error) throw new Error(error.message);
      const permitidas = new Set(((ok ?? []) as { id: string }[]).map((x) => x.id));
      for (const id of data.juntar) {
        if (!permitidas.has(id)) throw new Error("Uma das trocas escolhidas não pode ir junto (outra consultora ou já enviada).");
        const x = await dados(c, id, "ida");
        if (x.envio_vivo) throw new Error("Uma das trocas escolhidas já tem envio.");
        extras.push({ id, valor: x.valor_declarado_cents });
      }
      d.valor_declarado_cents += extras.reduce((a, x) => a + x.valor, 0);
    }
    const qtd = 1 + extras.length;
    // volta da troca = reversa (consultora → Lardan); ida = peça nova (Lardan → consultora)
    const corpo = api.corpoPrePostagem({
      direcao: data.direcao, remetente: d.remetente, destinatario: d.destinatario,
      valorDeclaradoCents: d.valor_declarado_cents, referencia: `Troca ${data.trocaId.slice(0, 8)} ${data.direcao}`,
    });
    const { valorDeclaradoAceito } = await import("./valor-declarado");
    corpo.itensDeclaracaoConteudo = [{ conteudo: "Semijoia (troca/garantia)", quantidade: String(qtd), valor: (valorDeclaradoAceito(d.valor_declarado_cents) / 100).toFixed(2) }];
    const envioId = await servidor<string>("qualidade_correios_abrir", {
      _troca: data.trocaId, _direcao: data.direcao, _ambiente: cfg.ambiente, _servico: corpo.codigoServico,
      _valor_cents: d.valor_declarado_cents, _payload: corpo, _ator: c.userId,
    });
    const extraIds: string[] = [];
    for (const x of extras) {
      extraIds.push(await servidor<string>("qualidade_correios_abrir", {
        _troca: x.id, _direcao: "ida", _ambiente: cfg.ambiente, _servico: corpo.codigoServico,
        _valor_cents: x.valor, _payload: { agrupado_com: envioId }, _ator: c.userId,
      }));
    }
    if (extraIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("qualidade_correios_envios").update({ agrupado_com: envioId }).in("id", extraIds);
    }
    const todos = [envioId, ...extraIds];
    let r: { http: number; dados: unknown };
    try { r = await api.criarPrePostagem(corpo); }
    catch (e) {
      for (const id of todos) await servidor("qualidade_correios_resultado", { _id: id, _ok: false, _resposta: null, _codigo: null, _prepostagem: null, _frete_cents: null, _erro: (e as Error).message });
      throw new Error((e as Error).message);
    }
    const o = (r.dados ?? {}) as Record<string, unknown>;
    const ok = r.http < 300 && typeof o["codigoObjeto"] === "string" && typeof o["id"] === "string";
    const frete = typeof o["precoPrePostagem"] === "number" ? Math.round((o["precoPrePostagem"] as number) * 100) : null;
    for (const id of todos) await servidor("qualidade_correios_resultado", {
      _id: id, _ok: ok, _resposta: o, _codigo: ok ? o["codigoObjeto"] : null, _prepostagem: ok ? o["id"] : null,
      _frete_cents: id === envioId ? frete : null, _erro: ok ? null : String(o["erro"] ?? "Os Correios recusaram a pré-postagem."),
    });
    if (!ok) throw new Error(String(o["erro"] ?? "Os Correios recusaram a pré-postagem."));
    let rotulo: string | null = null;
    try { rotulo = await guardarRotulo(envioId, data.trocaId, String(o["id"])); } catch { rotulo = null; }
    if (rotulo && extraIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("qualidade_correios_envios").update({ rotulo_path: `trocas/${data.trocaId}/${envioId}.pdf` }).in("id", extraIds);
    }
    return { envioId, codigoObjeto: String(o["codigoObjeto"]), rotulo, juntas: qtd };
  });

async function guardarRotulo(envioId: string, trocaId: string, idPre: string): Promise<string> {
  const api = await import("./api.server");
  const pdf = await api.rotuloPdf(idPre);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const caminho = `trocas/${trocaId}/${envioId}.pdf`;
  const up = await supabaseAdmin.storage.from("correios").upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  await servidor("qualidade_correios_rotulo", { _id: envioId, _path: caminho });
  const s = await supabaseAdmin.storage.from("correios").createSignedUrl(caminho, 600);
  return s.data?.signedUrl ?? "";
}

async function exigirQualidade(c: Ctx) {
  const { data, error } = await c.supabase.rpc("has_capability", { _user_id: c.userId, _cap: "quality.manage" });
  if (error || data !== true) throw new Error("Sem permissão para trocas pelos Correios.");
}

async function envio(id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("qualidade_correios_envios" as never).select("id,troca_id,prepostagem_id,rotulo_path,codigo_objeto,status").eq("id", id).maybeSingle();
  return data as { id: string; troca_id: string; prepostagem_id: string | null; rotulo_path: string | null; codigo_objeto: string | null; status: string } | null;
}

export const trocaCorreiosEtiqueta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { envioId: string }) => { if (!uuid(d?.envioId)) throw new Error("Pedido inválido."); return d; })
  .handler(async ({ data, context }) => {
    await exigirQualidade(context as unknown as Ctx);
    const e = await envio(data.envioId);
    if (!e?.prepostagem_id) throw new Error("Envio sem pré-postagem.");
    if (e.rotulo_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const s = await supabaseAdmin.storage.from("correios").createSignedUrl(e.rotulo_path, 600);
      if (s.data?.signedUrl) return { url: s.data.signedUrl };
    }
    return { url: await guardarRotulo(e.id, e.troca_id, e.prepostagem_id) };
  });

/** Rastreio de uma troca (ou de todas as pendentes, pela rotina da manhã). */
export async function atualizarRastrosTrocas(trocaId?: string) {
  const api = await import("./api.server");
  if (!api.configCorreios().pronto) return { consultados: 0, entregues: 0, erros: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from("qualidade_correios_envios" as never).select("id,codigo_objeto")
    .not("codigo_objeto", "is", null).in("status", ["pre_postada", "postada", "em_transito"]).limit(60);
  if (trocaId) q = q.eq("troca_id", trocaId);
  const { data } = await q;
  let entregues = 0, erros = 0;
  const lista = (data ?? []) as { id: string; codigo_objeto: string }[];
  for (const e of lista) {
    try {
      const r = await api.eventosRastro(e.codigo_objeto);
      if (r.http >= 300) { erros++; continue; }
      const s = await servidor<{ status: string }>("qualidade_correios_rastro", { _id: e.id, _eventos: r.eventos });
      if (s.status === "entregue") entregues++;
    } catch { erros++; }
  }
  return { consultados: lista.length, entregues, erros };
}

export const trocaCorreiosRastrear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { trocaId: string }) => { if (!uuid(d?.trocaId)) throw new Error("Pedido inválido."); return d; })
  .handler(async ({ data, context }) => {
    await exigirQualidade(context as unknown as Ctx);
    return atualizarRastrosTrocas(data.trocaId);
  });

export const trocaCorreiosCancelar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { envioId: string; motivo: string }) => {
    if (!uuid(d?.envioId) || (d?.motivo ?? "").trim().length < 3) throw new Error("Informe o motivo.");
    return { envioId: d.envioId, motivo: d.motivo.trim().slice(0, 300) };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirQualidade(c);
    const e = await envio(data.envioId);
    if (!e) throw new Error("Envio não encontrado.");
    if (e.codigo_objeto && e.status === "pre_postada") {
      const api = await import("./api.server");
      const r = await api.cancelarPrePostagem(e.codigo_objeto);
      if (r.http >= 300) throw new Error(String((r.dados as Record<string, unknown> | null)?.["erro"] ?? "Os Correios não cancelaram."));
    }
    await servidor("qualidade_correios_cancelar", { _id: e.id, _motivo: data.motivo, _ator: c.userId });
    // mesmo pacote: cancela as outras trocas que iam juntas
    if (e.codigo_objeto) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: irmas } = await supabaseAdmin.from("qualidade_correios_envios").select("id").eq("codigo_objeto", e.codigo_objeto).neq("id", e.id).in("status", ["criando", "pre_postada", "erro"]);
      for (const x of irmas ?? []) await servidor("qualidade_correios_cancelar", { _id: x.id, _motivo: data.motivo, _ator: c.userId });
    }
    return { ok: true };
  });

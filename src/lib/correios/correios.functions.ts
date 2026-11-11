/**
 * Correios — etapa 1 (diagnóstico): confirma a conexão com o contrato e
 * descobre os códigos de serviço reais (PAC de contrato e PAC reverso), o
 * preço e o prazo da caixa padrão. Só Master. Nada é postado nem cobrado.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };

async function exigirMaster(c: Ctx) {
  const { data, error } = await c.supabase.rpc("fiscal_focus_pode", { _acao: "emitir" });   // emitir = Master
  if (error || data !== true) throw new Error("Só o Master testa a conexão com os Correios.");
}

interface Servico { codigo: string; descricao: string }

export const correiosDiagnostico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cepDestino: string; codigos?: string[] }) => {
    if (!/^\d{8}$/.test((d?.cepDestino ?? "").replace(/\D/g, ""))) throw new Error("Informe um CEP de destino com 8 dígitos.");
    return { cepDestino: d.cepDestino.replace(/\D/g, ""), codigos: (d.codigos ?? []).filter((x) => /^\d{5}$/.test(x)).slice(0, 6) };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaster(c);
    const api = await import("./api.server");
    const cfg = api.configCorreios();
    const r: Record<string, unknown> = { ambiente: cfg.ambiente, faltando: cfg.faltando, cepOrigem: cfg.cepOrigem, caixa: api.CAIXA_PADRAO };
    if (!cfg.pronto) return { ...r, ok: false, etapa: "configuração" };

    try {
      const t = await api.token();
      r["token"] = { ok: true, expiraEm: t.expiraEm, contrato: t.resposta };
    } catch (e) {
      return { ...r, ok: false, etapa: "token", erro: e instanceof api.ErroCorreios ? e.message : "Não foi possível autenticar nos Correios. Tente novamente.", detalhe: null };
    }

    try {
    const sv = await api.servicosDoContrato();
    const lista = ((sv.dados as { itens?: unknown[] } | unknown[] | null) && (Array.isArray(sv.dados) ? sv.dados : (sv.dados as { itens?: unknown[] }).itens)) ?? [];
    const servicos: Servico[] = (lista as Record<string, unknown>[]).map((s) => ({
      codigo: String(s["codigo"] ?? s["codigoServico"] ?? s["coServico"] ?? ""),
      descricao: String(s["descricao"] ?? s["descricaoServico"] ?? s["nome"] ?? ""),
    })).filter((s) => s.codigo);
    r["servicos"] = { http: sv.http, total: servicos.length, lista: servicos };

    // PAC: os do contrato com "PAC" no nome + os pedidos na tela (padrões conhecidos 03298 PAC contrato, 03301 PAC reverso)
    const pac = servicos.filter((s) => /PAC/i.test(s.descricao)).map((s) => s.codigo);
    const testar = [...new Set([api.SERVICO.PAC_IDA, api.SERVICO.PAC_REVERSO, ...data.codigos, ...pac])].slice(0, 6);
    const precos: Record<string, unknown> = {};
    for (const cod of testar) {
      const [p, z] = await Promise.all([api.preco(cod, data.cepDestino), api.prazo(cod, data.cepDestino)]);
      precos[cod] = { descricao: servicos.find((s) => s.codigo === cod)?.descricao ?? null, preco: p, prazo: z };
    }
    r["testes"] = precos;
    // só os dois serviços da maleta decidem o resultado (PAC ida e PAC reverso); os outros são informativos
    const essenciais = [api.SERVICO.PAC_IDA, api.SERVICO.PAC_REVERSO].filter((cod) => precos[cod]);
    const ok = essenciais.length === 2 && sv.http >= 200 && sv.http < 300 && essenciais.every((cod) => {
      const t = precos[cod] as { preco: { http: number }; prazo: { http: number } };
      return t.preco.http >= 200 && t.preco.http < 300 && t.prazo.http >= 200 && t.prazo.http < 300;
    });
    r["essenciais"] = essenciais;
    return { ...r, ok, etapa: ok ? "concluído" : "consultas", ...(!ok ? { erro: "Uma ou mais consultas foram recusadas pelos Correios." } : {}) };
    } catch (e) {
      return { ...r, ok: false, etapa: "consultas", erro: e instanceof api.ErroCorreios ? e.message : "Não foi possível consultar os Correios. Tente novamente." };
    }
  });

export const correiosRastro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { codigo: string }) => {
    if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/i.test((d?.codigo ?? "").trim())) throw new Error("Código de rastreio inválido (ex.: AB123456789BR).");
    return { codigo: d.codigo.trim().toUpperCase() };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirMaster(c);
    const { rastro } = await import("./api.server");
    return rastro(data.codigo);
  });

// ───────────────────────── Etapas 2 e 3: envio da maleta, rastreio e volta ─────────────────────────

async function exigirKits(c: Ctx) {
  const { data, error } = await c.supabase.rpc("correios_pode", {});
  if (error || data !== true) throw new Error("Sem permissão para enviar maleta pelos Correios.");
}
async function servidor<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as { rpc: Rpc }).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
interface DadosEnvio {
  direcao: "ida" | "volta"; destinatario: import("./api.server").EnderecoCorreios; remetente: import("./api.server").EnderecoCorreios;
  valor_declarado_cents: number; debito_vencido_cents: number; pendencias: string[];
  envio_vivo: { id: string; status: string; codigo_objeto: string | null } | null;
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** Prévia: dados, pendências, débito e preço/prazo — antes de gerar a etiqueta. */
export const correiosPreviaEnvio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycleId: string; direcao: "ida" | "volta" }) => {
    if (!uuid(d?.cycleId) || !["ida", "volta"].includes(d?.direcao)) throw new Error("Pedido inválido.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirKits(c);
    const { data: dados, error } = await c.supabase.rpc("correios_maleta_dados", { _cycle: data.cycleId, _direcao: data.direcao });
    if (error) throw new Error(error.message);
    const d = dados as DadosEnvio;
    const api = await import("./api.server");
    const cfg = api.configCorreios();
    let cotacao: { frete_cents: number | null; prazo_dias: number | null; erro: string | null } = { frete_cents: null, prazo_dias: null, erro: null };
    if (cfg.pronto && /^\d{8}$/.test(d.destinatario?.cep ?? "")) {
      try {
        const cod = data.direcao === "ida" ? api.SERVICO.PAC_IDA : api.SERVICO.PAC_REVERSO;
        const cepDestino = data.direcao === "ida" ? d.destinatario.cep : d.remetente.cep;   // preço é simétrico; usa o CEP da consultora
        const [p, z] = await Promise.all([api.preco(cod, cepDestino, d.valor_declarado_cents), api.prazo(cod, cepDestino)]);
        const pf = (p.dados as Record<string, unknown> | null)?.["pcFinal"];
        cotacao = {
          frete_cents: typeof pf === "string" ? Math.round(Number(pf.replace(/\./g, "").replace(",", ".")) * 100) : null,
          prazo_dias: Number((z.dados as Record<string, unknown> | null)?.["prazoEntrega"] ?? NaN) || null,
          erro: p.http >= 300 ? String((p.dados as Record<string, unknown> | null)?.["erro"] ?? "") : null,
        };
      } catch (e) { cotacao.erro = (e as Error).message; }
    }
    const { valorDeclaradoAceito } = await import("./valor-declarado");
    return { ...d, valor_declarado_correios_cents: valorDeclaradoAceito(d.valor_declarado_cents), ambiente: cfg.ambiente, configurado: cfg.pronto, cotacao };
  });

/** Gera a pré-postagem (ida PAC ou volta reversa), grava o código e guarda a etiqueta em PDF. */
export const correiosEnviarMaleta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycleId: string; direcao: "ida" | "volta"; liberarDebito?: string | null }) => {
    if (!uuid(d?.cycleId) || !["ida", "volta"].includes(d?.direcao)) throw new Error("Pedido inválido.");
    return { cycleId: d.cycleId, direcao: d.direcao, liberarDebito: (d.liberarDebito ?? "").trim().slice(0, 300) || null };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirKits(c);
    const api = await import("./api.server");
    const cfg = api.configCorreios();
    if (!cfg.pronto) throw new Error(`Correios não configurado: falta ${cfg.faltando.join(", ")}.`);
    const { data: dados, error } = await c.supabase.rpc("correios_maleta_dados", { _cycle: data.cycleId, _direcao: data.direcao });
    if (error) throw new Error(error.message);
    const d = dados as DadosEnvio;
    const vd = await import("./valor-declarado");
    const montar = (faixa?: import("./valor-declarado").FaixaValorDeclarado) => api.corpoPrePostagem({ direcao: data.direcao, remetente: d.remetente, destinatario: d.destinatario,
      valorDeclaradoCents: d.valor_declarado_cents, referencia: `Maleta ${data.cycleId.slice(0, 8)} ${data.direcao}`, faixa });
    let corpo = montar();
    const servico = corpo.codigoServico;
    // 1) registra antes de chamar (regras, débito e "um envio vivo" no banco)
    const envioId = await servidor<string>("correios_envio_abrir", {
      _cycle: data.cycleId, _direcao: data.direcao, _ambiente: cfg.ambiente, _servico: servico,
      _valor_cents: vd.valorDeclaradoAceito(d.valor_declarado_cents), _payload: corpo, _ator: c.userId, _liberar_debito: data.liberarDebito,
    });
    // 2) pré-postagem
    let r: { http: number; dados: unknown };
    try {
      r = await api.criarPrePostagem(corpo);
      // recusa por faixa do valor declarado: tenta uma vez com a faixa que os próprios Correios informaram
      const faixa = r.http >= 300 ? vd.faixaDoErro(String(((r.dados ?? {}) as Record<string, unknown>)["erro"] ?? "")) : null;
      if (faixa) { corpo = montar(faixa); r = await api.criarPrePostagem(corpo); }
    }
    catch (e) {
      await servidor("correios_envio_resultado", { _id: envioId, _ok: false, _resposta: null, _codigo: null, _prepostagem: null, _frete_cents: null, _prazo: null, _erro: (e as Error).message });
      throw new Error((e as Error).message);
    }
    const o = (r.dados ?? {}) as Record<string, unknown>;
    const ok = r.http < 300 && typeof o["codigoObjeto"] === "string" && typeof o["id"] === "string";
    const frete = typeof o["precoPrePostagem"] === "number" ? Math.round((o["precoPrePostagem"] as number) * 100) : null;
    await servidor("correios_envio_resultado", {
      _id: envioId, _ok: ok, _resposta: o, _codigo: ok ? o["codigoObjeto"] : null, _prepostagem: ok ? o["id"] : null,
      _frete_cents: frete, _prazo: null, _erro: ok ? null : String(o["erro"] ?? "Os Correios recusaram a pré-postagem."),
    });
    if (!ok) throw new Error(String(o["erro"] ?? "Os Correios recusaram a pré-postagem."));
    // 3) etiqueta (falha aqui não desfaz a pré-postagem; dá para baixar depois)
    let rotulo: string | null = null;
    try { rotulo = await guardarRotulo(envioId, data.cycleId, String(o["id"])); } catch { rotulo = null; }
    return { envioId, codigoObjeto: String(o["codigoObjeto"]), rotulo, aviso: rotulo ? null : "Etiqueta ainda não ficou pronta: use \"Baixar etiqueta\" em instantes." };
  });

async function guardarRotulo(envioId: string, cycleId: string, idPre: string): Promise<string> {
  const api = await import("./api.server");
  const pdf = await api.rotuloPdf(idPre);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const caminho = `${cycleId}/${envioId}.pdf`;
  const up = await supabaseAdmin.storage.from("correios").upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  await servidor("correios_envio_rotulo", { _id: envioId, _path: caminho });
  const s = await supabaseAdmin.storage.from("correios").createSignedUrl(caminho, 600);
  return s.data?.signedUrl ?? "";
}

/** Link da etiqueta (gera de novo se ainda não foi guardada). */
export const correiosEtiqueta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { envioId: string }) => { if (!uuid(d?.envioId)) throw new Error("Pedido inválido."); return d; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirKits(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: e } = await supabaseAdmin.from("correios_envios" as never).select("id,cycle_id,prepostagem_id,rotulo_path,status").eq("id", data.envioId).maybeSingle();
    const env = e as { id: string; cycle_id: string; prepostagem_id: string | null; rotulo_path: string | null; status: string } | null;
    if (!env?.prepostagem_id) throw new Error("Envio sem pré-postagem.");
    if (env.rotulo_path) {
      const s = await supabaseAdmin.storage.from("correios").createSignedUrl(env.rotulo_path, 600);
      if (s.data?.signedUrl) return { url: s.data.signedUrl };
    }
    return { url: await guardarRotulo(env.id, env.cycle_id, env.prepostagem_id) };
  });

/** Atualiza o rastreio (uma maleta, ou todas as pendentes quando chamado pela rotina da manhã). */
export async function atualizarRastros(cycleId?: string): Promise<{ consultados: number; entregues: number; erros: number }> {
  const api = await import("./api.server");
  if (!api.configCorreios().pronto) return { consultados: 0, entregues: 0, erros: 0 };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let lista: { id: string; codigo_objeto: string; cycle_id: string }[];
  if (cycleId) {
    const { data } = await supabaseAdmin.from("correios_envios" as never).select("id,codigo_objeto,cycle_id")
      .eq("cycle_id", cycleId).not("codigo_objeto", "is", null).in("status", ["pre_postada", "postada", "em_transito"]);
    lista = (data ?? []) as typeof lista;
  } else {
    lista = await servidor<typeof lista>("correios_para_rastrear", { _limite: 60 });
  }
  let entregues = 0, erros = 0;
  for (const e of lista) {
    try {
      const r = await api.eventosRastro(e.codigo_objeto);
      if (r.http >= 300) { erros++; continue; }
      const salvo = await servidor<{ status: string }>("correios_envio_rastro", { _id: e.id, _eventos: r.eventos });
      if (salvo.status === "entregue") entregues++;
    } catch { erros++; }
  }
  return { consultados: lista.length, entregues, erros };
}

export const correiosRastrearMaleta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cycleId: string }) => { if (!uuid(d?.cycleId)) throw new Error("Pedido inválido."); return d; })
  .handler(async ({ data, context }) => {
    await exigirKits(context as unknown as Ctx);
    return atualizarRastros(data.cycleId);
  });

/** Cancela nos Correios e no Lardan um envio ainda não postado. */
export const correiosCancelarEnvio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { envioId: string; motivo: string }) => {
    if (!uuid(d?.envioId) || (d?.motivo ?? "").trim().length < 3) throw new Error("Informe o motivo.");
    return { envioId: d.envioId, motivo: d.motivo.trim().slice(0, 300) };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirKits(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: e } = await supabaseAdmin.from("correios_envios" as never).select("codigo_objeto,status").eq("id", data.envioId).maybeSingle();
    const env = e as { codigo_objeto: string | null; status: string } | null;
    if (!env) throw new Error("Envio não encontrado.");
    if (env.codigo_objeto && env.status === "pre_postada") {
      const api = await import("./api.server");
      const r = await api.cancelarPrePostagem(env.codigo_objeto);
      if (r.http >= 300) throw new Error(String((r.dados as Record<string, unknown> | null)?.["erro"] ?? "Os Correios não cancelaram."));
    }
    await servidor("correios_envio_cancelar", { _id: data.envioId, _motivo: data.motivo, _ator: c.userId });
    return { ok: true };
  });

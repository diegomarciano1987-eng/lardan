/**
 * 0402 — WhatsApp Cloud API (Meta), só no servidor.
 * Segredos (Lovable › Secrets; nunca no código, em log ou em resposta para a tela):
 *   WHATSAPP_TOKEN (usuário do sistema, sem validade), WHATSAPP_APP_SECRET (assinatura do webhook),
 *   WHATSAPP_PIN (PIN de 6 dígitos do número), WHATSAPP_VERIFY_TOKEN (frase combinada com o webhook).
 * Configuração (não secreta, mas fica junto): WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID.
 */
import { MODELOS, type Modelo } from "./textos";

const VERSAO = "v21.0";
const env = (k: string) => (process.env[k] ?? "").trim();

export const SEGREDOS = ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PIN", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID"] as const;
export const segredosPresentes = () => Object.fromEntries(SEGREDOS.map((k) => [k, env(k).length > 0])) as Record<(typeof SEGREDOS)[number], boolean>;

/** Erros que não adianta tentar de novo (número sem WhatsApp, fora da janela de 24 h, parâmetro inválido…). */
const DEFINITIVOS = new Set([100, 131008, 131009, 131021, 131026, 131030, 131047, 131051, 132000, 132005, 132007, 132012, 132015, 132016, 368]);

export class ErroMeta extends Error {
  constructor(mensagem: string, readonly codigo: number | null, readonly definitivo: boolean) { super(mensagem); }
}

async function graph<T = Record<string, unknown>>(caminho: string, corpo?: unknown, metodo: "GET" | "POST" = "POST"): Promise<T> {
  const token = env("WHATSAPP_TOKEN");
  if (!token) throw new ErroMeta("WhatsApp ainda não configurado (falta a chave).", null, false);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSAO}/${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } } & T;
    if (!r.ok || j.error) {
      const codigo = j.error?.code ?? null;
      const msg = `${j.error?.message ?? `HTTP ${r.status}`}${j.error?.error_data?.details ? ` — ${j.error.error_data.details}` : ""}`;
      throw new ErroMeta(msg.slice(0, 400), codigo, codigo !== null && DEFINITIVOS.has(codigo));
    }
    return j;
  } catch (e) {
    if (e instanceof ErroMeta) throw e;
    throw new ErroMeta(`Sem resposta da Meta: ${(e as Error).message}`.slice(0, 300), null, false);
  } finally {
    clearTimeout(t);
  }
}

const numero = () => {
  const id = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!/^\d{5,20}$/.test(id)) throw new ErroMeta("Falta o ID do número (WHATSAPP_PHONE_NUMBER_ID).", null, false);
  return id;
};
const conta = () => {
  const id = env("WHATSAPP_WABA_ID");
  if (!/^\d{5,20}$/.test(id)) throw new ErroMeta("Falta o ID da conta do WhatsApp (WHATSAPP_WABA_ID).", null, false);
  return id;
};
const idDe = (r: { messages?: { id?: string }[] }) => r.messages?.[0]?.id ?? "";

export async function enviarTexto(para: string, texto: string) {
  return idDe(await graph(`${numero()}/messages`, { messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "text", text: { body: texto.slice(0, 4096), preview_url: true } }));
}

export async function enviarBotoes(para: string, texto: string, botoes: string[]) {
  return idDe(await graph(`${numero()}/messages`, {
    messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "interactive",
    interactive: { type: "button", body: { text: texto.slice(0, 1024) }, action: { buttons: botoes.slice(0, 3).map((b, i) => ({ type: "reply", reply: { id: `b${i + 1}`, title: b.slice(0, 20) } })) } },
  }));
}

export async function enviarModelo(para: string, nome: string, params: string[], url?: string | null) {
  const componentes: unknown[] = [];
  if (params.length) componentes.push({ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p).slice(0, 200) })) });
  if (url) componentes.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: url }] });
  return idDe(await graph(`${numero()}/messages`, {
    messaging_product: "whatsapp", to: para, type: "template",
    template: { name: nome, language: { code: "pt_BR" }, components: componentes },
  }));
}

export async function marcarLida(wamid: string) {
  try { await graph(`${numero()}/messages`, { messaging_product: "whatsapp", status: "read", message_id: wamid }); } catch { /* só cortesia */ }
}

/** Ativa o número na API (usa o PIN de 6 dígitos) e liga os avisos da conta para o app. Pode repetir. */
export async function ativarNumero() {
  const pin = env("WHATSAPP_PIN");
  if (!/^\d{6}$/.test(pin)) throw new ErroMeta("Falta o PIN de 6 dígitos (WHATSAPP_PIN).", null, true);
  await graph(`${numero()}/register`, { messaging_product: "whatsapp", pin });
  await graph(`${conta()}/subscribed_apps`, {});
  return statusNumero();
}

export type StatusNumero = { numero: string | null; nome: string | null; nome_status: string | null; qualidade: string | null; status: string | null; plataforma: string | null };
export async function statusNumero(): Promise<StatusNumero> {
  const r = await graph<{ display_phone_number?: string; verified_name?: string; name_status?: string; quality_rating?: string; status?: string; platform_type?: string }>(
    `${numero()}?fields=display_phone_number,verified_name,name_status,quality_rating,status,platform_type`, undefined, "GET");
  return { numero: r.display_phone_number ?? null, nome: r.verified_name ?? null, nome_status: r.name_status ?? null, qualidade: r.quality_rating ?? null, status: r.status ?? null, plataforma: r.platform_type ?? null };
}

export type StatusModelo = { nome: string; status: string; categoria: string | null; motivo: string | null };
export async function listarModelos(): Promise<StatusModelo[]> {
  const r = await graph<{ data?: { name: string; status: string; category?: string; rejected_reason?: string; language?: string }[] }>(
    `${conta()}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`, undefined, "GET");
  const nossos = new Set(MODELOS.map((m) => m.nome));
  return (r.data ?? []).filter((m) => nossos.has(m.name) && (m.language ?? "pt_BR") === "pt_BR")
    .map((m) => ({ nome: m.name, status: m.status, categoria: m.category ?? null, motivo: m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : null }));
}

function corpoModelo(m: Modelo) {
  const botoes = m.botoes.map((b) => b.tipo === "URL"
    ? { type: "URL", text: b.texto, url: b.url, example: [b.exemplo] }
    : { type: "QUICK_REPLY", text: b.texto });
  return {
    name: m.nome, language: "pt_BR", category: m.categoria,
    components: [
      { type: "BODY", text: m.corpo, example: { body_text: [m.exemplo] } },
      ...(botoes.length ? [{ type: "BUTTONS", buttons: botoes }] : []),
    ],
  };
}

/** Envia para aprovação só os modelos que ainda não existem (pode repetir sem duplicar). */
export async function enviarModelosParaAprovacao() {
  const existentes = new Set((await listarModelos()).map((m) => m.nome));
  const enviados: string[] = [];
  const erros: { nome: string; erro: string }[] = [];
  for (const m of MODELOS) {
    if (existentes.has(m.nome)) continue;
    try { await graph(`${conta()}/message_templates`, corpoModelo(m)); enviados.push(m.nome); }
    catch (e) { erros.push({ nome: m.nome, erro: (e as Error).message }); }
  }
  return { enviados, erros, modelos: await listarModelos() };
}

/** Assinatura do aviso da Meta: X-Hub-Signature-256 = sha256=HMAC(App Secret, corpo bruto). */
export async function assinaturaValida(bruto: string, cabecalho: string | null) {
  const segredo = env("WHATSAPP_APP_SECRET");
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const esperado = Buffer.from(createHmac("sha256", segredo).update(bruto, "utf8").digest("hex"), "utf8");
  const recebido = Buffer.from(cabecalho.slice(7), "utf8");
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export const tokenVerificacao = () => env("WHATSAPP_VERIFY_TOKEN");

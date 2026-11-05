/**
 * Transporte API dos Correios (CWS). Somente servidor.
 *
 * Segredos (Lovable > Secrets):
 *   CORREIOS_USUARIO         usuário do Meu Correios
 *   CORREIOS_CODIGO_ACESSO   código de acesso às APIs (gerado no CWS) — nunca no código nem no chat
 *   CORREIOS_CARTAO          cartão de postagem
 *   CORREIOS_CONTRATO        contrato
 *   CORREIOS_DR              superintendência do contrato (36 = PR)
 *   CORREIOS_AMBIENTE        "homologacao" (padrão) ou "producao"
 *   CORREIOS_CEP_ORIGEM      CEP de postagem (padrão 86200055, Ibiporã)
 * Fail-closed: sem credencial, nada é enviado e nada é simulado.
 */
export type AmbienteCorreios = "homologacao" | "producao";

export function configCorreios() {
  const ambiente: AmbienteCorreios = process.env["CORREIOS_AMBIENTE"] === "producao" ? "producao" : "homologacao";
  const c = {
    ambiente,
    base: ambiente === "producao" ? "https://api.correios.com.br" : "https://apihom.correios.com.br",
    usuario: (process.env["CORREIOS_USUARIO"] ?? "").trim(),
    codigo: (process.env["CORREIOS_CODIGO_ACESSO"] ?? "").trim(),
    cartao: (process.env["CORREIOS_CARTAO"] ?? "").replace(/\D/g, ""),
    contrato: (process.env["CORREIOS_CONTRATO"] ?? "").replace(/\D/g, ""),
    dr: Number(process.env["CORREIOS_DR"] ?? 0) || null,
    cepOrigem: (process.env["CORREIOS_CEP_ORIGEM"] ?? "86200055").replace(/\D/g, ""),
  };
  const faltando = [!c.usuario && "CORREIOS_USUARIO", !c.codigo && "CORREIOS_CODIGO_ACESSO", !c.cartao && "CORREIOS_CARTAO",
    !c.contrato && "CORREIOS_CONTRATO"].filter(Boolean) as string[];
  return { ...c, pronto: faltando.length === 0, faltando };
}

export class ErroCorreios extends Error {
  constructor(message: string, readonly http: number | null = null, readonly corpo: unknown = null) { super(message); }
}

// token em memória do servidor (a API limita a 3 pedidos de token por segundo)
let cache: { token: string; expira: number; ambiente: string } | null = null;

export async function token(): Promise<{ token: string; expiraEm: string | null; resposta: unknown }> {
  const c = configCorreios();
  if (!c.pronto) throw new ErroCorreios(`Correios não configurado: falta ${c.faltando.join(", ")}.`);
  if (cache && cache.ambiente === c.ambiente && cache.expira - Date.now() > 5 * 60_000) return { token: cache.token, expiraEm: new Date(cache.expira).toISOString(), resposta: null };
  const r = await fetch(`${c.base}/token/v1/autentica/cartaopostagem`, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.usuario}:${c.codigo}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ numero: c.cartao, contrato: c.contrato, ...(c.dr ? { dr: c.dr } : {}) }),
  });
  const dados = await lerJson(r);
  if (!r.ok) throw new ErroCorreios(`Autenticação recusada pelos Correios (${r.status}). Confira as credenciais e o contrato.`, r.status);
  const d = dados as { token?: string; expiraEm?: string };
  if (!d.token) throw new ErroCorreios("A resposta do token veio sem token.", r.status);
  cache = { token: d.token, expira: d.expiraEm ? Date.parse(d.expiraEm) : Date.now() + 50 * 60_000, ambiente: c.ambiente };
  // devolve a resposta sem o token (para mostrar contrato/cartão/DR na tela)
  const semToken = { expiraEm: d.expiraEm ?? null };
  return { token: d.token, expiraEm: d.expiraEm ?? null, resposta: semToken };
}

async function lerJson(r: Response): Promise<unknown> {
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return { texto: t.slice(0, 500) }; }
}
/** Chamada autenticada; devolve status e corpo sem lançar (o diagnóstico mostra tudo). */
export async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<{ http: number; dados: unknown }> {
  const c = configCorreios();
  const { token: t } = await token();
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${c.base}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json" },
      body: corpo === undefined ? null : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const dados = await lerJson(r);
    return { http: r.status, dados: r.ok ? dados : { erro: `Consulta recusada pelos Correios (${r.status}).` } };
  } catch (e) {
    throw new ErroCorreios((e as Error).name === "AbortError" ? "Os Correios não responderam em 30 segundos." : "Falha de rede ao falar com os Correios.");
  } finally {
    clearTimeout(tm);
  }
}

/** Caixa padrão da maleta (Diego, 05/11/2026): 40×30×10 cm, 1 kg, PAC na ida e na volta. */
export const CAIXA_PADRAO = { comprimento: 40, largura: 30, altura: 10, pesoGramas: 1000, formato: "2" } as const;

export function servicosDoContrato() {
  const c = configCorreios();
  return chamar("GET", `/meucontrato/v1/empresas/${c.usuario.replace(/\D/g, "")}/contratos/${c.contrato}/servicos?page=0&size=100`);
}

export function preco(codigoServico: string, cepDestino: string, valorDeclaradoCents = 0) {
  const c = configCorreios();
  const q = new URLSearchParams({
    cepOrigem: c.cepOrigem, cepDestino: cepDestino.replace(/\D/g, ""), psObjeto: String(CAIXA_PADRAO.pesoGramas), tpObjeto: CAIXA_PADRAO.formato,
    comprimento: String(CAIXA_PADRAO.comprimento), largura: String(CAIXA_PADRAO.largura), altura: String(CAIXA_PADRAO.altura),
    nuContrato: c.contrato, ...(c.dr ? { nuDR: String(c.dr) } : {}),
    ...(valorDeclaradoCents > 0 ? { vlDeclarado: (valorDeclaradoCents / 100).toFixed(2), servicosAdicionais: "064" } : {}),
  });
  return chamar("GET", `/preco/v1/nacional/${encodeURIComponent(codigoServico)}?${q}`);
}

export function prazo(codigoServico: string, cepDestino: string) {
  const c = configCorreios();
  const q = new URLSearchParams({ cepOrigem: c.cepOrigem, cepDestino: cepDestino.replace(/\D/g, "") });
  return chamar("GET", `/prazo/v1/nacional/${encodeURIComponent(codigoServico)}?${q}`);
}

export function rastro(codigoObjeto: string) {
  return chamar("GET", `/srorastro/v1/objetos/${encodeURIComponent(codigoObjeto.trim().toUpperCase())}?resultado=T`);
}

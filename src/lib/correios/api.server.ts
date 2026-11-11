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
import { valorDeclaradoAceito, type FaixaValorDeclarado } from "./valor-declarado";
export type AmbienteCorreios = "homologacao" | "producao";
export type JsonCorreios = null | boolean | number | string | JsonCorreios[] | { [key: string]: JsonCorreios };

export function configCorreios() {
  // trim/minúsculas: um espaço sobrando no segredo não pode jogar o sistema para homologação
  const ambiente: AmbienteCorreios = (process.env["CORREIOS_AMBIENTE"] ?? "").trim().toLowerCase() === "producao" ? "producao" : "homologacao";
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
let cache: { token: string; expira: number; identidade: string } | null = null;

// pedidos simultâneos (pico de etiquetas) esperam o MESMO pedido de token, em vez de cada um pedir o seu
let emAndamento: { identidade: string; promessa: Promise<{ token: string; expiraEm: string | null; resposta: unknown }> } | null = null;

/** Esquece o token guardado (os Correios recusaram com 401: venceu antes ou foi revogado). */
export function esquecerToken() { cache = null; }

export async function token(): Promise<{ token: string; expiraEm: string | null; resposta: unknown }> {
  const c = configCorreios();
  if (!c.pronto) throw new ErroCorreios(`Correios não configurado: falta ${c.faltando.join(", ")}.`);
  const identidade = JSON.stringify([c.ambiente, c.usuario, c.codigo, c.cartao, c.contrato, c.dr]);
  if (cache && cache.identidade === identidade && cache.expira - Date.now() > 5 * 60_000) return { token: cache.token, expiraEm: new Date(cache.expira).toISOString(), resposta: null };
  if (emAndamento && emAndamento.identidade === identidade) return emAndamento.promessa;
  const promessa = pedirToken(c, identidade);
  emAndamento = { identidade, promessa };
  try { return await promessa; } finally { if (emAndamento?.promessa === promessa) emAndamento = null; }
}

async function pedirToken(c: ReturnType<typeof configCorreios>, identidade: string): Promise<{ token: string; expiraEm: string | null; resposta: unknown }> {
  const r = await fetch(`${c.base}/token/v1/autentica/cartaopostagem`, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.usuario}:${c.codigo}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ numero: c.cartao, contrato: c.contrato, ...(c.dr ? { dr: c.dr } : {}) }),
  });
  const dados = await lerJson(r);
  if (!r.ok) throw new ErroCorreios(`Autenticação recusada pelos Correios (${r.status}). Confira as credenciais e o contrato.`, r.status);
  const d = dados as { token?: string; expiraEm?: string };
  if (!d?.token) throw new ErroCorreios("A resposta do token veio sem token.", r.status);
  cache = { token: d.token, expira: d.expiraEm ? Date.parse(d.expiraEm) : Date.now() + 50 * 60_000, identidade };
  // devolve a resposta sem o token (para mostrar contrato/cartão/DR na tela)
  const semToken = { expiraEm: d.expiraEm ?? null };
  return { token: d.token, expiraEm: d.expiraEm ?? null, resposta: semToken };
}

async function lerJson(r: Response): Promise<JsonCorreios> {
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return { texto: t.slice(0, 500) }; }
}
/** Mensagem que os Correios devolvem no erro (campo msgs), sem dados pessoais nem token. */
function mensagemCorreios(d: JsonCorreios): string | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const m = (d as Record<string, JsonCorreios>)["msgs"];
  if (Array.isArray(m) && m.length) return m.map(String).join(" ").slice(0, 400);
  const x = (d as Record<string, JsonCorreios>)["mensagem"] ?? (d as Record<string, JsonCorreios>)["message"];
  return typeof x === "string" ? x.slice(0, 400) : null;
}

/** Chamada autenticada; devolve status e corpo sem lançar (o diagnóstico mostra tudo). */
export async function chamar(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<{ http: number; dados: JsonCorreios }> {
  const r = await chamarUmaVez(metodo, caminho, corpo);
  // token recusado: pede um novo e tenta UMA vez (só leitura ou pedido que os Correios recusaram sem processar)
  if (r.http === 401) { esquecerToken(); return chamarUmaVez(metodo, caminho, corpo); }
  return r;
}

async function chamarUmaVez(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<{ http: number; dados: JsonCorreios }> {
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
    if (r.ok) return { http: r.status, dados };
    const msg = mensagemCorreios(dados);
    return { http: r.status, dados: { erro: `Recusado pelos Correios (${r.status})${msg ? `: ${msg}` : "."}` } };
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
  valorDeclaradoCents = valorDeclaradoAceito(valorDeclaradoCents);
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

/** Serviços usados na maleta (confirmados no contrato em 05/11/2026). */
export const SERVICO = { PAC_IDA: "03298", PAC_REVERSO: "03301", VALOR_DECLARADO_PAC: "064" } as const;

export interface EnderecoCorreios {
  nome: string; doc: string | null; email: string | null; ddd: string | null; celular: string | null; telefone: string | null;
  cep: string; logradouro: string; numero: string; complemento: string | null; bairro: string; cidade: string; uf: string;
}
const corta = (v: string | null | undefined, n: number) => (v ?? "").normalize("NFC").trim().slice(0, n);
function pessoa(e: EnderecoCorreios, papel: "remetente" | "destinatario") {
  const end = {
    cep: e.cep, logradouro: corta(e.logradouro, 50), numero: corta(e.numero || "S/N", 6), complemento: corta(e.complemento, 30) || undefined,
    bairro: corta(e.bairro, 30), cidade: corta(e.cidade, 30), uf: corta(e.uf, 2).toUpperCase(),
  };
  return {
    nome: corta(e.nome, 50), ...(e.doc ? { cpfCnpj: e.doc } : {}), ...(e.email ? { email: corta(e.email, 255) } : {}),
    ...(e.ddd && e.celular ? { dddCelular: e.ddd, celular: e.celular } : {}),
    ...(e.ddd && e.telefone ? { dddTelefone: e.ddd, telefone: e.telefone } : {}),
    endereco: papel === "destinatario" ? { ...end, regiao: end.uf } : end,
  };
}
const dataBR = (d: Date) => d.toISOString().slice(0, 10);

/** Monta o corpo da pré-postagem (ida = PAC; volta = PAC reverso com logística reversa). */
export function corpoPrePostagem(o: {
  direcao: "ida" | "volta"; remetente: EnderecoCorreios; destinatario: EnderecoCorreios;
  valorDeclaradoCents: number; referencia: string; validadeReversaDias?: number; faixa?: FaixaValorDeclarado;
}) {
  const valor = valorDeclaradoAceito(o.valorDeclaradoCents, o.faixa) / 100;
  const hoje = new Date(Date.now() - 3 * 3600_000);
  const validade = new Date(hoje.getTime() + (o.validadeReversaDias ?? 7) * 86_400_000);
  return {
    remetente: pessoa(o.remetente, "remetente"),
    destinatario: pessoa(o.destinatario, "destinatario"),
    codigoServico: o.direcao === "ida" ? SERVICO.PAC_IDA : SERVICO.PAC_REVERSO,
    pesoInformado: String(CAIXA_PADRAO.pesoGramas),
    codigoFormatoObjetoInformado: CAIXA_PADRAO.formato,
    alturaInformada: String(CAIXA_PADRAO.altura), larguraInformada: String(CAIXA_PADRAO.largura), comprimentoInformado: String(CAIXA_PADRAO.comprimento),
    cienteObjetoNaoProibido: "1",
    modalidadePagamento: "2",                                  // a faturar no contrato
    observacao: corta(o.referencia, 50),
    pedidoExternoOrigem: corta(o.referencia, 25),
    itensDeclaracaoConteudo: [{ conteudo: "Semijoias (bijuterias) em consignação", quantidade: "1", valor: valor.toFixed(2) }],
    ...(valor > 0 ? { listaServicoAdicional: [{ codigoServicoAdicional: SERVICO.VALOR_DECLARADO_PAC, valorDeclarado: valor.toFixed(2) }] } : {}),
    ...(o.direcao === "volta" ? { logisticaReversa: "S", dataValidadeLogReversa: dataBR(validade) } : {}),
  };
}

export function criarPrePostagem(corpo: unknown) {
  return chamar("POST", "/prepostagem/v1/prepostagens", corpo);
}
export function cancelarPrePostagem(codigoObjeto: string) {
  return chamar("DELETE", `/prepostagem/v1/prepostagens/objeto/${encodeURIComponent(codigoObjeto)}`);
}

/** Rótulo em PDF: pede de forma assíncrona e busca o arquivo (tenta por até ~20 s). */
export async function rotuloPdf(idPrePostagem: string): Promise<Uint8Array> {
  const c = configCorreios();
  const pedido = await chamar("POST", "/prepostagem/v1/prepostagens/rotulo/assincrono/pdf", {
    idsPrePostagem: [idPrePostagem], numeroCartaoPostagem: c.cartao, tipoRotulo: "P", formatoRotulo: "ET", imprimeRemetente: "S", layoutImpressao: "PADRAO",
  });
  const recibo = (pedido.dados as Record<string, JsonCorreios> | null)?.["idRecibo"];
  if (pedido.http >= 300 || typeof recibo !== "string") {
    throw new ErroCorreios(String((pedido.dados as Record<string, JsonCorreios> | null)?.["erro"] ?? "Os Correios não aceitaram o pedido de etiqueta."), pedido.http);
  }
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const d = await chamar("GET", `/prepostagem/v1/prepostagens/rotulo/download/assincrono/${encodeURIComponent(recibo)}`);
    const o = d.dados as Record<string, JsonCorreios> | null;
    const b64 = o?.["dados"] ?? o?.["arquivo"] ?? o?.["pdf"];
    if (d.http < 300 && typeof b64 === "string" && b64.length > 100) return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  throw new ErroCorreios("A etiqueta ainda está sendo gerada pelos Correios. Tente baixar de novo em 1 minuto.");
}

/** Eventos do rastreio, no formato que o banco entende (codigo, tipo, dtHrCriado, descricao). */
export async function eventosRastro(codigoObjeto: string) {
  const r = await rastro(codigoObjeto);
  const objetos = ((r.dados as Record<string, JsonCorreios> | null)?.["objetos"] ?? []) as Record<string, JsonCorreios>[];
  const ev = ((objetos[0]?.["eventos"] ?? []) as Record<string, JsonCorreios>[]).map((e) => ({
    codigo: String(e["codigo"] ?? ""), tipo: String(e["tipo"] ?? ""), dtHrCriado: String(e["dtHrCriado"] ?? ""),
    descricao: String(e["descricao"] ?? ""),
    unidade: (() => { const u = e["unidade"] as Record<string, JsonCorreios> | undefined; const end = u?.["endereco"] as Record<string, JsonCorreios> | undefined; return end ? `${end["cidade"] ?? ""}/${end["uf"] ?? ""}` : null; })(),
  }));
  return { http: r.http, eventos: ev };
}

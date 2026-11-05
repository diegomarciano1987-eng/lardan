/**
 * Transporte ZapSign (API v1). Somente servidor.
 *
 * Segredos (Lovable > Secrets):
 *   ZAPSIGN_API_TOKEN       token da conta (Configurações › Integração › ZAPSIGN API)
 *   ZAPSIGN_AMBIENTE        "producao" (padrão) ou "sandbox"
 *   ZAPSIGN_WEBHOOK_SECRET  segredo longo e aleatório; vai na URL do aviso cadastrada na ZapSign
 * Fail-closed: sem token, nada é enviado e nada é simulado.
 */
export type AmbienteZapsign = "producao" | "sandbox";

export function configZapsign() {
  const token = process.env["ZAPSIGN_API_TOKEN"] ?? "";
  const ambiente: AmbienteZapsign = process.env["ZAPSIGN_AMBIENTE"] === "sandbox" ? "sandbox" : "producao";
  const base = ambiente === "sandbox" ? "https://sandbox.api.zapsign.com.br" : "https://api.zapsign.com.br";
  const faltando = [!token && "ZAPSIGN_API_TOKEN", !process.env["ZAPSIGN_WEBHOOK_SECRET"] && "ZAPSIGN_WEBHOOK_SECRET"].filter(Boolean) as string[];
  return { token, ambiente, base, pronto: !!token, avisoPronto: !!process.env["ZAPSIGN_WEBHOOK_SECRET"], faltando };
}

export class ErroZapsign extends Error {
  constructor(message: string, readonly http: number | null = null) { super(message); }
}

async function chamar<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  const cfg = configZapsign();
  if (!cfg.pronto) throw new ErroZapsign("ZapSign não configurada: falta ZAPSIGN_API_TOKEN.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(`${cfg.base}/api/v1${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: corpo === undefined ? null : JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = { detail: texto.slice(0, 300) }; }
    if (r.status === 401 || r.status === 403) throw new ErroZapsign("A ZapSign recusou o token (confira ZAPSIGN_API_TOKEN e o ambiente).", r.status);
    if (r.status >= 400) {
      throw new ErroZapsign(`A ZapSign recusou a consulta (${r.status}).`, r.status);
    }
    return dados as T;
  } catch (e) {
    if (e instanceof ErroZapsign) throw e;
    throw new ErroZapsign((e as Error).name === "AbortError" ? "A ZapSign não respondeu em 30 segundos." : "Falha de rede ao falar com a ZapSign.");
  } finally {
    clearTimeout(t);
  }
}

export interface SignerZapsign { token: string; sign_url: string; status: string; name: string; signed_at: string | null;
  email?: string | null; phone_country?: string | null; phone_number?: string | null; cpf?: string | null }
export interface DocZapsign { token: string; status: string; name: string; external_id?: string | null; signed_file: string | null; original_file?: string | null;
  created_at?: string | null; signers: SignerZapsign[] }

export function criarDocumento(corpo: {
  name: string; markdown_text: string; external_id: string;
  signers: { name: string; phone_country?: string; phone_number?: string; email?: string; cpf?: string; auth_mode: string;
             send_automatic_whatsapp: boolean; send_automatic_email: boolean; lock_name: boolean; lock_phone: boolean; external_id: string; custom_message?: string }[];
  brand_name?: string; lang: "pt-br";
}) {
  return chamar<DocZapsign>("POST", "/docs/", corpo);
}

export function detalharDocumento(docToken: string) {
  return chamar<DocZapsign>("GET", `/docs/${encodeURIComponent(docToken)}/`);
}

/** Lista de documentos da conta (inclui os criados direto no painel). Paginada. */
export function listarDocumentos(pagina: number) {
  return chamar<{ count: number; next: string | null; results: { token: string; name: string; status: string; created_at?: string }[] }>(
    "GET", `/docs/?page=${Math.max(1, Math.trunc(pagina))}`);
}

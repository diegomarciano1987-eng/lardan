/**
 * Transporte Clicksign (API v3, JSON:API). Somente servidor.
 *
 * Fail-closed: sem modo ativo, sem token do ambiente ou sem saída de rede
 * liberada (CLICKSIGN_EGRESS_ENABLED=true), nada é enviado e nada é simulado.
 * Segredos: CLICKSIGN_SANDBOX_TOKEN, CLICKSIGN_PRODUCAO_TOKEN, CLICKSIGN_WEBHOOK_SECRET.
 * Formatos conferidos na documentação pública da v3; validar na homologação.
 */
export type ModoClicksign = "desligado" | "sandbox" | "producao";

const BASE: Record<Exclude<ModoClicksign, "desligado">, string> = {
  sandbox: "https://sandbox.clicksign.com/api/v3",
  producao: "https://app.clicksign.com/api/v3",
};

export interface ConfigClicksign {
  modo: ModoClicksign;
  pronto: boolean;
  faltando: string[];
}

export function avaliarConfig(modo: ModoClicksign): ConfigClicksign {
  const faltando: string[] = [];
  if (modo === "desligado") return { modo, pronto: false, faltando: ["modo desligado"] };
  if (!process.env[modo === "sandbox" ? "CLICKSIGN_SANDBOX_TOKEN" : "CLICKSIGN_PRODUCAO_TOKEN"])
    faltando.push(modo === "sandbox" ? "CLICKSIGN_SANDBOX_TOKEN" : "CLICKSIGN_PRODUCAO_TOKEN");
  if (!process.env["CLICKSIGN_WEBHOOK_SECRET"]) faltando.push("CLICKSIGN_WEBHOOK_SECRET");
  if (process.env["CLICKSIGN_EGRESS_ENABLED"] !== "true") faltando.push("CLICKSIGN_EGRESS_ENABLED");
  return { modo, pronto: faltando.length === 0, faltando };
}

export class ErroClicksign extends Error {}

function cliente(modo: Exclude<ModoClicksign, "desligado">) {
  const cfg = avaliarConfig(modo);
  if (!cfg.pronto) throw new ErroClicksign("Clicksign não configurada.");
  const token = process.env[modo === "sandbox" ? "CLICKSIGN_SANDBOX_TOKEN" : "CLICKSIGN_PRODUCAO_TOKEN"]!;
  return async function chamar<T = { data: { id: string; attributes: Record<string, unknown> } }>(
    metodo: "GET" | "POST" | "PATCH",
    caminho: string,
    corpo?: unknown,
  ): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const resp = await fetch(`${BASE[modo]}${caminho}`, {
        method: metodo,
        headers: { Authorization: token, "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" },
        body: corpo ? JSON.stringify(corpo) : null,
        signal: ctrl.signal,
      });
      const texto = await resp.text();
      if (!resp.ok) throw new ErroClicksign(`Clicksign respondeu ${resp.status}.`);
      return (texto ? JSON.parse(texto) : {}) as T;
    } finally {
      clearTimeout(t);
    }
  };
}

export interface Signatario {
  nome: string;
  email: string;
  celular: string | null; // só dígitos com DDD
  cpf: string; // só dígitos
}

/** Cria envelope + documento + signatária + requisitos, ativa e notifica. */
export async function enviarParaAssinatura(
  modo: Exclude<ModoClicksign, "desligado">,
  opts: { nome: string; arquivo: string; pdfBase64: string; signataria: Signatario; autenticacao: "email" | "whatsapp" },
) {
  const api = cliente(modo);
  const prazo = new Date(Date.now() + 7 * 864e5).toISOString();
  const env = await api("POST", "/envelopes", {
    data: { type: "envelopes", attributes: { name: opts.nome, locale: "pt-BR", auto_close: true, remind_interval: 3, block_after_refusal: true, deadline_at: prazo } },
  });
  const envelopeId = env.data.id;
  const doc = await api("POST", `/envelopes/${envelopeId}/documents`, {
    data: { type: "documents", attributes: { filename: opts.arquivo, content_base64: `data:application/pdf;base64,${opts.pdfBase64}` } },
  });
  const cpf = opts.signataria.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  const canal = opts.autenticacao === "whatsapp" && opts.signataria.celular ? "whatsapp" : "email";
  const sig = await api("POST", `/envelopes/${envelopeId}/signers`, {
    data: {
      type: "signers",
      attributes: {
        name: opts.signataria.nome,
        email: opts.signataria.email,
        phone_number: opts.signataria.celular ?? undefined,
        has_documentation: true,
        documentation: cpf,
        refusable: true,
        communicate_events: { signature_request: canal, signature_reminder: canal, document_signed: "email" },
      },
    },
  });
  const rel = { document: { data: { type: "documents", id: doc.data.id } }, signer: { data: { type: "signers", id: sig.data.id } } };
  await api("POST", `/envelopes/${envelopeId}/requirements`, {
    data: { type: "requirements", attributes: { action: "agree", role: "receipt" }, relationships: rel },
  });
  await api("POST", `/envelopes/${envelopeId}/requirements`, {
    data: { type: "requirements", attributes: { action: "provide_evidence", auth: canal }, relationships: rel },
  });
  await api("PATCH", `/envelopes/${envelopeId}`, { data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } } });
  await api("POST", `/envelopes/${envelopeId}/notifications`, {
    data: { type: "notifications", attributes: { message: "Termo de recebimento da sua maleta Lardan." } },
  });
  return { envelopeId, documentId: doc.data.id, signerId: sig.data.id, canal };
}

/** Baixa o PDF assinado do documento. */
export async function baixarAssinado(modo: Exclude<ModoClicksign, "desligado">, envelopeId: string, documentId: string) {
  const api = cliente(modo);
  const d = await api("GET", `/envelopes/${envelopeId}/documents/${documentId}`);
  const links = (d.data.attributes["links"] ?? {}) as { files?: { signed?: string } };
  const url = links.files?.signed;
  if (!url) throw new ErroClicksign("Arquivo assinado ainda não disponível.");
  const resp = await fetch(url);
  if (!resp.ok) throw new ErroClicksign(`Download do assinado falhou (${resp.status}).`);
  return new Uint8Array(await resp.arrayBuffer());
}

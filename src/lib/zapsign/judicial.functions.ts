/**
 * 0318 — Acordo judicial para assinar pela ZapSign. A tela só pede; o banco confere que quem pede cobra
 * (cob_pode), que o acordo está vigente e que o PDF é desta pessoa. O PDF enviado é exatamente a minuta
 * anexada (o hash fica gravado); a devedora valida com código no WhatsApp (ou e-mail), selfie e documento.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
type Ctx = { supabase: { rpc: Rpc }; userId: string };
const UUID = /^[0-9a-f-]{36}$/i;
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const BUCKET = "extratos-bancarios"; // mesmo cofre privado dos documentos judiciais
const MAX_PDF = 10 * 1024 * 1024;

async function rpcUsuario<T>(c: Ctx, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function rpcServidor<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function exigirCobranca(c: Ctx) {
  const ok = await rpcUsuario<boolean>(c, "cob_pode", { _u: c.userId }).catch(() => false);
  if (!ok) throw new Error("Sem permissão de cobrança.");
}

interface DadosJud {
  party_id: string; pendente: { id: string; sign_url: string | null } | null; pendencias: string[];
  total_cents: number; data_acordo: string; processo: string; comarca: string; advogado: string;
  doc: { id: string; titulo: string; storage_path: string };
  signer: { nome: string; cpf: string | null; whatsapp: string | null; email: string | null };
}

export interface PedidoAcordoJudicial { acordoId: string; docId: string; reenviar?: boolean; advogado?: { nome: string; email: string } | null }

export const zapsignAcordoJudicial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PedidoAcordoJudicial) => {
    if (!UUID.test(d?.acordoId ?? "")) throw new Error("Acordo inválido.");
    if (!UUID.test(d?.docId ?? "")) throw new Error("Escolha o PDF do acordo.");
    const adv = d.advogado && (d.advogado.nome.trim() || d.advogado.email.trim()) ? { nome: d.advogado.nome.trim(), email: d.advogado.email.trim().toLowerCase() } : null;
    if (adv && (adv.nome.length < 3 || !EMAIL.test(adv.email))) throw new Error("Para incluir o advogado, informe nome e e-mail válidos.");
    return { acordoId: d.acordoId, docId: d.docId, reenviar: !!d.reenviar, advogado: adv };
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    const dados = await rpcUsuario<DadosJud>(c, "cob_judicial_assinatura_dados", { _acordo: data.acordoId, _doc: data.docId });
    if (dados.pendente && !data.reenviar) return { id: dados.pendente.id, signUrl: dados.pendente.sign_url, advogadoUrl: null, jaExistia: true, whatsapp: false, email: false };
    if (dados.pendencias.length) throw new Error(`Complete o cadastro antes de enviar: ${dados.pendencias.join(", ")}.`);

    const { configZapsign, criarDocumentoPdf } = await import("./api.server");
    const { telefoneZapsign } = await import("./modelo");
    const cfg = configZapsign();
    if (!cfg.pronto) throw new Error("Assinatura digital não configurada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const arq = await supabaseAdmin.storage.from(BUCKET).download(dados.doc.storage_path);
    if (arq.error || !arq.data) throw new Error("Não foi possível ler o PDF anexado.");
    const bytes = new Uint8Array(await arq.data.arrayBuffer());
    if (bytes.byteLength > MAX_PDF) throw new Error("O PDF passa de 10 MB.");
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("O arquivo anexado não é um PDF válido.");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const b64 = btoa(bin);

    const fone = telefoneZapsign(dados.signer.whatsapp);
    const email = dados.signer.email ?? undefined;
    const titulo = `Acordo judicial${dados.processo ? ` — autos ${dados.processo}` : ""} — ${dados.signer.nome}`.slice(0, 250);
    const signers: Parameters<typeof criarDocumentoPdf>[0]["signers"] = [{
      name: dados.signer.nome, ...(fone ?? {}), ...(email ? { email } : {}), ...(dados.signer.cpf ? { cpf: dados.signer.cpf } : {}),
      auth_mode: fone ? "assinaturaTela-tokenWhatsapp" : "assinaturaTela-tokenEmail",
      require_selfie_photo: true, require_document_photo: true, qualification: "Executada",
      send_automatic_whatsapp: !!fone, send_automatic_email: !!email,
      lock_name: true, lock_phone: !!fone, lock_email: !!email, external_id: dados.party_id,
      custom_message: "Olá! Segue o acordo do seu processo com a TSM / LARDAN para você assinar. Tenha seu documento em mãos: vamos pedir um código, uma selfie e a foto do documento.",
    }];
    if (data.advogado) signers.push({
      name: data.advogado.nome, email: data.advogado.email, auth_mode: "assinaturaTela-tokenEmail", qualification: "Advogado da exequente",
      send_automatic_whatsapp: false, send_automatic_email: true, lock_name: true, lock_phone: false, lock_email: true, external_id: `adv-${data.acordoId.slice(0, 8)}`,
    });
    const doc = await criarDocumentoPdf({
      name: titulo, base64_pdf: b64, external_id: `lardan-acjud-${data.acordoId.slice(0, 8)}-${Date.now().toString(36)}`,
      lang: "pt-br", brand_name: "LARDAN Semijoias", signers,
    });
    const devedora = doc.signers?.find((s) => s.name === dados.signer.nome) ?? doc.signers?.[0];
    const adv = data.advogado ? doc.signers?.find((s) => s.token !== devedora?.token) : undefined;
    const reg = await rpcServidor<{ id: string }>("assinatura_registrar", { _d: {
      ambiente: cfg.ambiente, tipo: "acordo_judicial", party_id: dados.party_id, cycle_id: "", rep: "", simulacao_id: "",
      judicial_acordo_id: data.acordoId, judicial_doc_id: data.docId,
      doc_token: doc.token, signer_token: devedora?.token ?? null, sign_url: devedora?.sign_url ?? null, status: "pendente",
      titulo, texto_hash: hash, valor_cents: String(dados.total_cents), whatsapp: !!fone, ator: c.userId, substitui: dados.pendente?.id ?? "",
      assinantes: [
        { papel: "devedora", nome: dados.signer.nome, whatsapp: !!fone, email: !!email },
        ...(data.advogado ? [{ papel: "advogado", nome: data.advogado.nome, email: true, sign_url: adv?.sign_url ?? null }] : []),
      ],
    } });
    return { id: reg.id, signUrl: devedora?.sign_url ?? null, advogadoUrl: adv?.sign_url ?? null, jaExistia: false, whatsapp: !!fone, email: !!email };
  });

/** Confere na ZapSign na hora (fonte da verdade) e guarda a cópia assinada. */
export const zapsignAcordoJudicialVerificar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!UUID.test(d?.id ?? "")) throw new Error("Documento inválido."); return { id: d.id }; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const x = await rpcServidor<{ tipo: string; doc_token: string | null } | null>("assinatura_ler", { _id: data.id });
    if (!x?.doc_token || x.tipo !== "acordo_judicial") throw new Error("Documento não encontrado.");
    const { importarDocumento } = await import("./documentos.server");
    await importarDocumento(x.doc_token);
    await rpcServidor("assinatura_conferida", { _doc_token: x.doc_token }).catch(() => null);
    const y = await rpcServidor<{ status?: string } | null>("assinatura_ler", { _id: data.id });
    return { status: y?.status ?? null };
  });

/** Abre o PDF assinado (cópia guardada) ou, enquanto pendente, o original na ZapSign. Link de 5 minutos. */
export const zapsignAcordoJudicialArquivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!UUID.test(d?.id ?? "")) throw new Error("Documento inválido."); return { id: d.id }; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const x = await rpcServidor<{ tipo: string; party_id: string; doc_token: string | null; arquivo_path: string | null } | null>("assinatura_ler", { _id: data.id });
    if (!x?.doc_token || x.tipo !== "acordo_judicial") throw new Error("Documento não encontrado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let caminho = x.arquivo_path;
    if (!caminho) {
      const { guardarCopia } = await import("./documentos.server");
      caminho = await guardarCopia(x.doc_token, x.party_id).catch(() => null);
    }
    if (caminho) {
      const s = await supabaseAdmin.storage.from("assinaturas").createSignedUrl(caminho, 300);
      if (!s.error) return { url: s.data.signedUrl, assinado: true };
    }
    const { detalharDocumento } = await import("./api.server");
    const d = await detalharDocumento(x.doc_token);
    return { url: d.signed_file ?? d.original_file ?? null, assinado: d.status === "signed" };
  });

/**
 * 0398 — Documentos da candidata aprovada.
 * Página pública /documentos/<token>: o token (64 hex) é a única chave; a página só recebe o primeiro nome.
 * O arquivo vai direto do celular dela para o bucket privado "candidatura-documentos" por um link assinado de envio
 * (gerado aqui, com caminho decidido pelo banco). Depois do envio o servidor confere no Storage o tamanho e o tipo
 * antes de registrar. Ninguém lê o bucket sem passar pelo servidor: a equipe vê por links assinados de 10 minutos.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BUCKET_DOCUMENTOS = "candidatura-documentos";
export const TIPOS_DOCUMENTO = ["documento", "comprovante", "selfie", "fachada"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_OK = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);

type Rpc = (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Storage = {
  from: (b: string) => {
    createSignedUploadUrl: (p: string) => Promise<{ data: { signedUrl: string; token: string; path: string } | null; error: { message: string } | null }>;
    list: (pasta: string, o: { search: string; limit: number }) => Promise<{ data: { name: string; metadata?: { size?: number; mimetype?: string } | null }[] | null; error: { message: string } | null }>;
    createSignedUrls: (p: string[], s: number) => Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: { message: string } | null }>;
  };
};
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as { rpc: Rpc; storage: Storage };

const Token = z.string().regex(/^[a-f0-9]{64}$/);
const Tipo = z.enum(TIPOS_DOCUMENTO);

/** Erros do banco → frase para a candidata. */
function frase(msg: string): string {
  if (msg.includes("link_vencido")) return "Este link venceu. Peça um novo para a Lardan pelo WhatsApp.";
  if (msg.includes("link_invalido")) return "Este link não vale mais. Fale com a Lardan pelo WhatsApp.";
  if (msg.includes("ja_conferido")) return "Esta foto já foi conferida pela Lardan e não precisa ser enviada de novo.";
  if (msg.includes("formato_invalido")) return "Formato não aceito. Envie uma foto (ou PDF, só no comprovante).";
  if (msg.includes("faltam_documentos")) return "Ainda falta enviar algum item.";
  return "Não foi possível agora. Tente de novo em instantes.";
}
async function limitar(token: string) {
  const { ipCliente, exigirLimites } = await import("@/lib/seguranca/limite.server");
  const ip = ipCliente();
  await exigirLimites([
    [ip ? `docs:ip:${ip}` : null, 120, 3600],
    [`docs:token:${token}`, 80, 3600],
  ], "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.");
}

export type PaginaDocumentos = {
  primeiro_nome: string; finalizado_em: string | null;
  itens: { tipo: TipoDocumento; situacao: "enviado" | "conferido" | "refazer"; motivo: string | null; enviado_em: string }[];
};

export const documentosAbrir = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token }).parse(d))
  .handler(async ({ data }) => {
    await limitar(data.token);
    const r = await (await admin()).rpc("candidatura_documentos_abrir", { _token: data.token });
    if (r.error) throw new Error(frase(r.error.message));
    return r.data as PaginaDocumentos;
  });

/** Link assinado para enviar UM arquivo (vale por 2 horas, só para aquele caminho). */
export const documentoEnvioPreparar = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token, tipo: Tipo, ext: z.enum(["jpg", "png", "webp", "heic", "pdf"]) }).parse(d))
  .handler(async ({ data }) => {
    await limitar(data.token);
    const sb = await admin();
    const c = await sb.rpc("candidatura_documento_caminho", { _token: data.token, _tipo: data.tipo, _ext: data.ext });
    if (c.error) throw new Error(frase(c.error.message));
    const caminho = c.data as string;
    const u = await sb.storage.from(BUCKET_DOCUMENTOS).createSignedUploadUrl(caminho);
    if (u.error || !u.data) throw new Error("Não foi possível preparar o envio agora. Tente de novo em instantes.");
    return { caminho, tokenEnvio: u.data.token };
  });

/** Depois do envio: confere no Storage (tamanho e tipo) e registra. */
export const documentoEnvioConfirmar = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token, tipo: Tipo, caminho: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    await limitar(data.token);
    const sb = await admin();
    const barra = data.caminho.lastIndexOf("/");
    const pasta = data.caminho.slice(0, barra);
    const nome = data.caminho.slice(barra + 1);
    const l = await sb.storage.from(BUCKET_DOCUMENTOS).list(pasta, { search: nome, limit: 2 });
    const obj = (l.data ?? []).find((o) => o.name === nome);
    if (l.error || !obj) throw new Error("A foto não chegou. Tente enviar de novo.");
    const bytes = Number(obj.metadata?.size ?? 0);
    const mime = String(obj.metadata?.mimetype ?? "");
    if (!bytes || bytes > MAX_BYTES) throw new Error("Arquivo vazio ou maior que 10 MB. Tire a foto de novo.");
    if (!MIME_OK.has(mime) || (mime === "application/pdf" && data.tipo !== "comprovante")) throw new Error(frase("formato_invalido"));
    const r = await sb.rpc("candidatura_documento_registrar", { _token: data.token, _tipo: data.tipo, _path: data.caminho, _mime: mime, _bytes: bytes });
    if (r.error) throw new Error(frase(r.error.message));
    return { ok: true };
  });

export const documentosFinalizar = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: Token }).parse(d))
  .handler(async ({ data }) => {
    await limitar(data.token);
    const r = await (await admin()).rpc("candidatura_documentos_finalizar", { _token: data.token });
    if (r.error) throw new Error(frase(r.error.message));
    return { ok: true };
  });

// ------------------------------------------------------------------ equipe
export type DocumentoEquipe = {
  id: string; tipo: TipoDocumento; situacao: "enviado" | "conferido" | "refazer"; motivo: string | null; mime: string;
  enviado_em: string; conferido_em: string | null; url: string | null;
};
export type DocumentosEquipe = {
  aprovada: boolean;
  link: { token: string; expira_em: string; finalizado_em: string | null; vencido: boolean } | null;
  itens: DocumentoEquipe[];
};

/** A permissão (candidaturas.view) é conferida pelo banco com a sessão de quem pediu; só depois o servidor assina os links. */
export const documentosDaCandidata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lead: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const cliente = (context as unknown as { supabase: { rpc: Rpc } }).supabase;
    const r = await cliente.rpc("candidatura_documentos_ver", { _lead: data.lead });
    if (r.error) throw new Error(r.error.message.includes("sem_permissao") ? "Sem permissão para ver os documentos." : r.error.message);
    const v = r.data as Omit<DocumentosEquipe, "itens"> & { itens: (Omit<DocumentoEquipe, "url"> & { path: string })[] };
    let urls = new Map<string, string>();
    if (v.itens.length) {
      const s = await (await admin()).storage.from(BUCKET_DOCUMENTOS).createSignedUrls(v.itens.map((i) => i.path), 600);
      urls = new Map((s.data ?? []).filter((x) => x.path).map((x) => [x.path!, x.signedUrl]));
    }
    return {
      aprovada: v.aprovada, link: v.link,
      itens: v.itens.map(({ path, ...i }) => ({ ...i, url: urls.get(path) ?? null })),
    } as DocumentosEquipe;
  });

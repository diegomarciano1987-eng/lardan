/** Comprovantes da cobrança: arquivo privado, enviado e lido só por quem pode cobrar. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "extratos-bancarios"; // privado; prefixo comprovantes/<pessoa>/
type Ctx = { supabase: { rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }> }; userId: string };

async function exigirCobranca(c: Ctx) {
  const { data, error } = await c.supabase.rpc("cob_pode", { _u: c.userId });
  if (error || !data) throw new Error("Sem permissão de cobrança.");
}

export const enviarComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partyId: string; simulacaoId?: string | null; installmentId?: string | null; referente: string; valorCents: number; dataPagamento: string; banco?: string; observacao?: string; arquivoNome: string; arquivoTipo: string; arquivoBase64: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.partyId ?? "")) throw new Error("Pessoa inválida.");
    if (!(d.valorCents > 0)) throw new Error("Informe o valor pago.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dataPagamento)) throw new Error("Informe a data do pagamento.");
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(d.arquivoTipo)) throw new Error("Envie foto (PNG/JPG) ou PDF.");
    if (d.arquivoBase64.length > 14_000_000) throw new Error("Arquivo maior que 10 MB.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = data.arquivoTipo === "application/pdf" ? "pdf" : data.arquivoTipo.split("/")[1];
    const caminho = `comprovantes/${data.partyId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bin = Uint8Array.from(atob(data.arquivoBase64), (ch) => ch.charCodeAt(0));
    const up = await supabaseAdmin.storage.from(BUCKET).upload(caminho, bin, { contentType: data.arquivoTipo });
    if (up.error) throw new Error("Não foi possível guardar o arquivo: " + up.error.message);
    const { data: id, error } = await c.supabase.rpc("cob_comprovante_registrar", {
      _d: { party_id: data.partyId, simulacao_id: data.simulacaoId ?? "", installment_id: data.installmentId ?? "", referente: data.referente,
        valor_cents: data.valorCents, data_pagamento: data.dataPagamento, banco: data.banco ?? "", observacao: data.observacao ?? "",
        storage_path: caminho, file_name: data.arquivoNome.slice(0, 200), content_type: data.arquivoTipo },
    });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([caminho]); throw new Error(error.message); }
    return { id: id as string };
  });

export const abrirComprovante = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!/^[0-9a-f-]{36}$/i.test(d?.id ?? "")) throw new Error("Comprovante inválido."); return d; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("cob_comprovantes").select("storage_path").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Comprovante não encontrado.");
    const s = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
    if (s.error) throw new Error(s.error.message);
    return { url: s.data.signedUrl };
  });

export const enviarDocJudicial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partyId: string; tipo: string; titulo: string; arquivoNome: string; arquivoTipo: string; arquivoBase64: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(d?.partyId ?? "")) throw new Error("Pessoa inválida.");
    if (!["termo_assinado", "peticao", "certidao", "sentenca", "comprovante", "outro"].includes(d.tipo)) throw new Error("Tipo inválido.");
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(d.arquivoTipo)) throw new Error("Envie PDF ou foto (PNG/JPG).");
    if (d.arquivoBase64.length > 28_000_000) throw new Error("Arquivo maior que 20 MB.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ext = data.arquivoTipo === "application/pdf" ? "pdf" : data.arquivoTipo.split("/")[1];
    const caminho = `judicial/${data.partyId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bin = Uint8Array.from(atob(data.arquivoBase64), (ch) => ch.charCodeAt(0));
    const up = await supabaseAdmin.storage.from(BUCKET).upload(caminho, bin, { contentType: data.arquivoTipo });
    if (up.error) throw new Error("Não foi possível guardar o arquivo: " + up.error.message);
    const { data: id, error } = await c.supabase.rpc("cob_judicial_doc_registrar", {
      _d: { party_id: data.partyId, tipo: data.tipo, titulo: data.titulo, storage_path: caminho, file_name: data.arquivoNome.slice(0, 200), content_type: data.arquivoTipo },
    });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([caminho]); throw new Error(error.message); }
    return { id: id as string };
  });

export const abrirDocJudicial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => { if (!/^[0-9a-f-]{36}$/i.test(d?.id ?? "")) throw new Error("Documento inválido."); return d; })
  .handler(async ({ data, context }) => {
    const c = context as unknown as Ctx;
    await exigirCobranca(c);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("cob_judicial_docs").select("storage_path").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Documento não encontrado.");
    const s = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
    if (s.error) throw new Error(s.error.message);
    return { url: s.data.signedUrl };
  });

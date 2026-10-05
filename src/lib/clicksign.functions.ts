import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const itemSchema = z.object({
  variant_id: z.string().uuid(),
  qty_accepted: z.number().int().min(0).max(100000),
  qty_divergent: z.number().int().min(0).max(100000),
  tipo_divergencia: z.enum(["faltante", "defeito"]).optional(),
  motivo: z.string().max(500).optional(),
});

export type ResultadoInicio =
  | { ok: true; canal: "email" | "whatsapp"; repetida?: boolean }
  | { ok: false; erro: string; faltando?: string[] };

/** Gera o termo imutável, guarda o PDF privado e envia à Clicksign. Só a consultora destinatária. */
export const iniciarAssinatura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ cycleId: z.string().uuid(), itens: z.array(itemSchema).min(1).max(500), chave: z.string().min(8).max(100) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ResultadoInicio> => {
    const { avaliarConfig, enviarParaAssinatura } = await import("./clicksign/api.server");
    const { gerarTermoPdf, sha256Hex } = await import("./clicksign/termo.server");
    const { BUCKET_TERMOS } = await import("./clicksign/fluxo.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfgRow } = await supabaseAdmin.from("clicksign_settings").select("modo, autenticacao").eq("id", 1).single();
    const modo = (cfgRow?.modo ?? "desligado") as "desligado" | "sandbox" | "producao";
    const cfg = avaliarConfig(modo);
    if (modo === "desligado") return { ok: false, erro: "A assinatura eletrônica não está ativa." };
    if (!cfg.pronto) return { ok: false, erro: "Clicksign não configurada. Avise a Matriz." };

    // Dados mínimos da signatária, lidos no servidor.
    const { data: eu } = await context.supabase.rpc("my_party_id" as never);
    const partyId = eu as unknown as string | null;
    if (!partyId) return { ok: false, erro: "Seu login não está ligado a um cadastro." };
    const { data: p } = await supabaseAdmin.from("parties").select("display_name, legal_name, doc_digits").eq("id", partyId).single();
    const { data: contatos } = await supabaseAdmin
      .from("contact_points")
      .select("kind, value, is_primary")
      .eq("party_id", partyId)
      .order("is_primary", { ascending: false });
    const email = contatos?.find((c) => c.kind === "email")?.value ?? (context.claims as { email?: string }).email ?? null;
    const celular = (contatos?.find((c) => c.kind === "whatsapp")?.value ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "") || null;
    const nome = p?.legal_name || p?.display_name || null;
    const cpf = (p?.doc_digits ?? "").replace(/\D/g, "");
    const faltando: string[] = [];
    if (!nome) faltando.push("nome completo");
    if (cpf.length !== 11) faltando.push("CPF");
    if (!email) faltando.push("e-mail");
    if (cfgRow?.autenticacao === "whatsapp" && !celular) faltando.push("WhatsApp");
    if (faltando.length)
      return { ok: false, erro: "Precisamos completar alguns dados do seu cadastro antes de gerar o termo de recebimento.", faltando };

    // Conferência imutável, como a própria consultora (o banco decide quem pode).
    const prep = await context.supabase.rpc("kit_assinatura_preparar", {
      _cycle: data.cycleId,
      _itens: data.itens,
      _idempotency_key: data.chave,
    });
    if (prep.error) return { ok: false, erro: prep.error.message };
    const r = prep.data as unknown as { request_id: string; estado: string; sha256: string; repetida?: boolean; snapshot: never };
    if (r.repetida && r.estado !== "preparado") return { ok: true, canal: "email", repetida: true };

    try {
      const pdf = await gerarTermoPdf(r.snapshot, cpf, r.sha256);
      const pdfSha = await sha256Hex(pdf);
      const caminho = `${data.cycleId}/${r.request_id}/termo.pdf`;
      const up = await supabaseAdmin.storage.from(BUCKET_TERMOS).upload(caminho, pdf, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error("Não foi possível guardar o termo.");
      let b64 = "";
      for (let i = 0; i < pdf.length; i += 0x8000) b64 += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
      const env = await enviarParaAssinatura(modo, {
        nome: `Termo de recebimento — ${(r.snapshot as { maleta: string }).maleta}`,
        arquivo: `termo-${r.request_id}.pdf`,
        pdfBase64: btoa(b64),
        signataria: { nome: nome!, email: email!, celular, cpf },
        autenticacao: (cfgRow?.autenticacao ?? "email") as "email" | "whatsapp",
      });
      const reg = await supabaseAdmin.rpc("kit_assinatura_registrar_envio", {
        _request: r.request_id,
        _payload: { pdf_path: caminho, pdf_sha256: pdfSha, envelope_id: env.envelopeId, document_id: env.documentId, signer_id: env.signerId },
      });
      if (reg.error) throw new Error(reg.error.message);
      return { ok: true, canal: env.canal as "email" | "whatsapp" };
    } catch (e) {
      const motivo = e instanceof Error ? e.message : "Falha ao enviar.";
      await supabaseAdmin.rpc("kit_assinatura_falha", { _request: r.request_id, _motivo: motivo });
      return { ok: false, erro: `Não foi possível enviar o termo agora (${motivo}). Tente de novo em instantes.` };
    }
  });

/** Link temporário (5 min) para o termo original ou assinado — só quem enxerga a maleta. */
export const linkTermo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: z.string().uuid(), tipo: z.enum(["original", "assinado"]) }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS: só devolve a linha se a maleta estiver no escopo de quem pede.
    const { data: r } = await context.supabase
      .from("kit_signature_requests")
      .select("pdf_path, signed_path")
      .eq("id", data.requestId)
      .maybeSingle();
    const caminho = data.tipo === "assinado" ? r?.signed_path : r?.pdf_path;
    if (!caminho) return { ok: false as const, erro: "Arquivo indisponível." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await supabaseAdmin.storage.from("termos-maleta").createSignedUrl(caminho, 300);
    if (s.error) return { ok: false as const, erro: "Arquivo indisponível." };
    return { ok: true as const, url: s.data.signedUrl };
  });

/** Situação da integração para quem administra (sem revelar segredos). */
export const situacaoClicksign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: master } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "master" });
    const { data: s } = await context.supabase.from("clicksign_settings").select("modo, termo_versao, termo_aprovado, autenticacao").eq("id", 1).single();
    const { avaliarConfig } = await import("./clicksign/api.server");
    const modo = (s?.modo ?? "desligado") as "desligado" | "sandbox" | "producao";
    const sandbox = avaliarConfig("sandbox");
    const producao = avaliarConfig("producao");
    return {
      master: master === true,
      modo,
      versao: s?.termo_versao ?? "",
      aprovado: s?.termo_aprovado ?? false,
      autenticacao: s?.autenticacao ?? "email",
      sandboxPronto: sandbox.pronto,
      producaoPronto: producao.pronto,
      faltando: master ? avaliarConfig(modo === "desligado" ? "sandbox" : modo).faltando : [],
    };
  });

/** Reprocessa termos assinados cujo arquivo ainda não foi guardado. */
export const reprocessarAssinados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: pode } = await context.supabase.rpc("has_capability" as never, { _user_id: context.userId, _cap: "kit.manage" } as never);
    if (pode !== true) return { ok: false, erro: "Sem permissão." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { finalizarAssinado } = await import("./clicksign/fluxo.server");
    const { data } = await supabaseAdmin.from("kit_signature_requests").select("id").eq("estado", "assinado").limit(20);
    let ok = 0;
    for (const r of data ?? []) if ((await finalizarAssinado(r.id)).ok) ok++;
    return { ok: true, processados: data?.length ?? 0, finalizados: ok };
  });

/**
 * Aviso da ZapSign — POST /api/public/zapsign/webhook?chave=<ZAPSIGN_WEBHOOK_SECRET>
 * Cadastrar na ZapSign (Configurações › Integração › Webhooks) com a chave na URL.
 * O conteúdo do aviso NÃO é confiado: o servidor consulta o documento na API
 * da ZapSign e só então atualiza a assinatura. Documento desconhecido → 200.
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 256 * 1024;

export const Route = createFileRoute("/api/public/zapsign/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { timingSafeEqual } = await import("node:crypto");
        const segredo = process.env["ZAPSIGN_WEBHOOK_SECRET"];
        if (!segredo) return new Response("Não configurado.", { status: 503 });
        const recebido = Buffer.from(new URL(request.url).searchParams.get("chave") ?? "", "utf8");
        const esperado = Buffer.from(segredo, "utf8");
        if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return new Response("Não autorizado.", { status: 401 });

        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Payload grande demais.", { status: 413 });
        let corpo: Record<string, unknown>;
        try { corpo = JSON.parse(bruto) as Record<string, unknown>; } catch { return new Response("Payload inválido.", { status: 400 }); }
        const token = String(corpo["token"] ?? (corpo["doc"] as { token?: string } | undefined)?.token ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("ok", { status: 200 });

        try {
          const { detalharDocumento } = await import("@/lib/zapsign/api.server");
          const d = await detalharDocumento(token);   // fonte da verdade: a API, não o aviso
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpc = supabaseAdmin.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ error: unknown }>;
          const r = await rpc("assinatura_retorno", { _doc_token: token, _status: d.status, _assinado_em: d.signers?.[0]?.signed_at ?? null });
          if (r.error) return new Response("Erro ao registrar.", { status: 500 });
        } catch {
          return new Response("Falha ao consultar a ZapSign.", { status: 502 });
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});

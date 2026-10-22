/**
 * Aviso da Focus NFe — POST /api/public/focus/webhook
 * A Focus manda o segredo no cabeçalho X-Lardan-Focus (cadastrado por
 * "Registrar aviso na Focus"). Autentica → deduplica no banco → atualiza a nota.
 * Referência desconhecida responde 200 (a Focus não deve ficar reenviando).
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 256 * 1024;

export const Route = createFileRoute("/api/public/focus/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const segredo = process.env["FOCUS_WEBHOOK_SECRET"];
        if (!segredo) return new Response("Não configurado.", { status: 503 });

        const recebido = Buffer.from(request.headers.get("x-lardan-focus") ?? "", "utf8");
        const esperado = Buffer.from(segredo, "utf8");
        if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
          return new Response("Não autorizado.", { status: 401 });
        }

        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Payload grande demais.", { status: 413 });
        let corpo: Record<string, unknown>;
        try {
          corpo = JSON.parse(bruto) as Record<string, unknown>;
        } catch {
          return new Response("Payload inválido.", { status: 400 });
        }
        const ref = String(corpo["ref"] ?? "");
        if (!/^[A-Za-z0-9_-]{6,60}$/.test(ref)) return new Response("ok", { status: 200 });

        const dedupe = createHash("sha256").update(bruto).digest("hex");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const rpc = supabaseAdmin.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ error: unknown }>;
        const r = await rpc("fiscal_focus_retorno", { _ref: ref, _fonte: "webhook", _resposta: corpo, _dedupe: dedupe });
        if (r.error) return new Response("Erro ao registrar.", { status: 500 });
        return new Response("ok", { status: 200 });
      },
    },
  },
});

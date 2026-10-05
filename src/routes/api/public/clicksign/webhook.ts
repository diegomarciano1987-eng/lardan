/**
 * Aviso da Clicksign — POST /api/public/clicksign/webhook
 * Cabeçalho Content-Hmac: sha256=<hex> (HMAC-SHA256 do corpo com CLICKSIGN_WEBHOOK_SECRET).
 * Autentica → deduplica no banco antes de qualquer efeito → em "assinado", baixa o
 * PDF assinado, guarda em local privado e só então libera a maleta (atômico no banco).
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 256 * 1024;

export const Route = createFileRoute("/api/public/clicksign/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { createHmac, createHash, timingSafeEqual } = await import("node:crypto");
        const segredo = process.env["CLICKSIGN_WEBHOOK_SECRET"];
        if (!segredo) return new Response("Não configurado.", { status: 503 });

        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Payload grande demais.", { status: 413 });

        const recebido = (request.headers.get("content-hmac") ?? "").replace(/^sha256=/, "");
        const esperado = createHmac("sha256", segredo).update(bruto).digest("hex");
        const a = Buffer.from(recebido, "utf8");
        const b = Buffer.from(esperado, "utf8");
        if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Assinatura inválida.", { status: 401 });

        let corpo: Record<string, any>;
        try {
          corpo = JSON.parse(bruto);
        } catch {
          return new Response("Payload inválido.", { status: 400 });
        }
        const evento: string = String(corpo?.event?.name ?? corpo?.event ?? "").slice(0, 60);
        const envelope: string = String(
          corpo?.envelope?.id ?? corpo?.data?.envelope?.id ?? corpo?.event?.data?.envelope?.id ?? corpo?.document?.envelope_key ?? "",
        ).slice(0, 100);
        if (!evento || !envelope) return new Response("ok", { status: 200 });
        const dedupe = createHash("sha256").update(bruto).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const r = await supabaseAdmin.rpc("kit_assinatura_evento", { _dedupe: dedupe, _envelope: envelope, _evento: evento });
        if (r.error) return new Response("Erro ao registrar.", { status: 500 });
        const res = r.data as { request_id?: string; baixar?: boolean } | null;
        if (res?.baixar && res.request_id) {
          const { finalizarAssinado } = await import("@/lib/clicksign/fluxo.server");
          await finalizarAssinado(res.request_id); // falha fica registrada e pode ser reprocessada
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});

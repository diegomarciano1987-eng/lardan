/**
 * 0402 — Aviso da Meta (WhatsApp Cloud API) para a Lara.
 * GET: verificação do webhook (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST: só aceita com assinatura válida (X-Hub-Signature-256 com o WHATSAPP_APP_SECRET); o conteúdo vai para o roteiro.
 * Cadastrar no app da Meta: URL https://www.lardan.com.br/api/public/whatsapp/webhook, campo "messages".
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 1024 * 1024;

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { tokenVerificacao } = await import("@/lib/lara/meta.server");
        const u = new URL(request.url);
        const esperado = tokenVerificacao();
        const recebido = u.searchParams.get("hub.verify_token") ?? "";
        const a = Buffer.from(recebido, "utf8");
        const b = Buffer.from(esperado, "utf8");
        if (!esperado || u.searchParams.get("hub.mode") !== "subscribe" || a.length !== b.length) return new Response("Não autorizado.", { status: 403 });
        const { timingSafeEqual } = await import("node:crypto");
        if (!timingSafeEqual(a, b)) return new Response("Não autorizado.", { status: 403 });
        return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
      },
      POST: async ({ request }) => {
        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Grande demais.", { status: 413 });
        const { assinaturaValida } = await import("@/lib/lara/meta.server");
        if (!(await assinaturaValida(bruto, request.headers.get("x-hub-signature-256")))) return new Response("Não autorizado.", { status: 401 });
        let aviso: unknown;
        try { aviso = JSON.parse(bruto); } catch { return new Response("ok", { status: 200 }); }
        try {
          const { tratarAviso } = await import("@/lib/lara/fluxo.server");
          await tratarAviso(aviso as Parameters<typeof tratarAviso>[0]);
        } catch (e) {
          console.error("[lara] aviso:", (e as Error).message);
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});

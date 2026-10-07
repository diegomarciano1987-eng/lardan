import { createFileRoute } from "@tanstack/react-router";

/** Rotina da manhã (agendada no banco): espelha cobranças Asaas, concilia e baixa recebidas. */
export const Route = createFileRoute("/api/public/asaas/sync-matinal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const esperado = process.env["ASAAS_SYNC_CRON_TOKEN"];
        const tok = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
        if (!esperado) return new Response("Server configuration error", { status: 500 });
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const h = (v: string) => createHash("sha256").update(v).digest();
        if (!tok || !timingSafeEqual(h(tok), h(esperado))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin.from("consultora_cobranca_config" as never).select("ator_user_id").limit(1).maybeSingle();
        const actor = (cfg as { ator_user_id: string } | null)?.ator_user_id;
        if (!actor) return new Response("Sem responsável técnico configurado", { status: 500 });
        const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
        try {
          const { executarSyncAsaas } = await import("@/lib/asaas/espelho.server");
          const r = await executarSyncAsaas({ actor, de: "2020-01-01", ate: hoje, ignorarIntervalo: true });
          return Response.json({ ok: true, ...r });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

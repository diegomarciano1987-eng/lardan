import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** 0402 — A cada minuto: lembrete do dia 2, expiração e envio da fila da Lara. */
export const Route = createFileRoute("/api/public/lara/processar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { rodarRotina } = await import("@/lib/lara/fluxo.server");
          return Response.json({ ok: true, ...(await rodarRotina()) });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** 0395 — A cada minuto: consulta o crédito e decide as candidaturas que terminaram o teste (até 10 por vez). */
export const Route = createFileRoute("/api/public/captacao/processar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { processarFila } = await import("@/lib/captacao/processar.server");
          return Response.json({ ok: true, ...(await processarFila(10)) });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** A cada minuto: envia até 20 candidaturas da fila para a Central de Leads (limite deles: 120/min). */
export const Route = createFileRoute("/api/public/central-leads/enviar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { processarFila } = await import("@/lib/central-leads.server");
          return Response.json({ ok: true, ...(await processarFila(20)) });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

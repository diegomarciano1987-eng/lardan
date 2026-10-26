import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Agendamento a cada minuto: localiza no mapa as consultoras novas/alteradas (ativas primeiro)
 * e refina por rua quem só tinha CEP. Lote curto porque o agendador espera poucos segundos.
 */
export const Route = createFileRoute("/api/public/rede/localizar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { processarLote } = await import("@/lib/rede/geocode.server");
          const r = await processarLote(null, 4, { orcamentoMs: 3_500 });
          return Response.json({ ok: true, ...r });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

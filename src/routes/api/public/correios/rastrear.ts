import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** 2x por dia (8h e 15h de Brasília): rastreio de maletas e trocas; entrega confirmada sozinha pelos eventos dos Correios. */
export const Route = createFileRoute("/api/public/correios/rastrear")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { atualizarRastros } = await import("@/lib/correios/correios.functions");
          const { atualizarRastrosTrocas } = await import("@/lib/correios/troca.functions");
          const maletas = await atualizarRastros();
          return Response.json({ ok: true, maletas, trocas: await atualizarRastrosTrocas() });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

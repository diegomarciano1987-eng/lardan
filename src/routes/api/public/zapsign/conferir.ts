import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * 0266 — agendamento a cada 10 minutos: relê na ZapSign os documentos ainda "aguardando assinatura"
 * (rodízio, lote curto). Garante que contrato/promissória assinados apareçam como assinados mesmo
 * quando o aviso automático da ZapSign não chega.
 */
export const Route = createFileRoute("/api/public/zapsign/conferir")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { conferirPendentes } = await import("@/lib/zapsign/documentos.server");
          const r = await conferirPendentes(8, 20_000);
          return Response.json({ ok: true, ...r });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

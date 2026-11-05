import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** A cada 10 minutos: expira compras da vitrine não pagas em 60 min e cancela no Asaas cobranças de pedidos cancelados. */
export const Route = createFileRoute("/api/public/vitrine/expirar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { limparCobrancasDePedidos } = await import("@/lib/vitrine-compra.server");
          return Response.json({ ok: true, ...(await limparCobrancasDePedidos()) });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

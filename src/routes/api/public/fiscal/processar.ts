import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * A cada minuto (0216): emite as notas da fila automática (remessa na maleta
 * conferida, acerto na maleta encerrada) e manda a cópia XML/DANFE das notas
 * de produção ao escritório. Sem produção ligada pelo Master, não emite nada.
 */
export const Route = createFileRoute("/api/public/fiscal/processar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        try {
          const { processarFilaFiscal } = await import("@/lib/focus/emissao.server");
          return Response.json({ ok: true, ...(await processarFilaFiscal(5)) });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

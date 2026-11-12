import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * 0299 — a cada minuto: baixa feita no Lardan (manual, OFX, outra conta) ou título cancelado
 * cancela a cobrança antiga no Asaas e, havendo saldo, cria outra pelo saldo exato.
 */
export const Route = createFileRoute("/api/public/asaas/saldo-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const inicio = Date.now();
        try {
          const { sincronizarSaldosProducao } = await import("@/lib/asaas/saldo.server");
          const r = await sincronizarSaldosProducao(20);
          if (r.processadas > 0) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("audit_logs").insert({
              actor_id: null as never, action: "asaas.saldo.sync", entity: "asaas_saldo_sync", entity_id: "rotina",
              payload: { ...r, ms: Date.now() - inicio } as never,
            });
          }
          return Response.json({ ok: true, ...r });
        } catch (e) {
          const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
          return Response.json({ ok: false, erro: msg }, { status: 500 });
        }
      },
    },
  },
});

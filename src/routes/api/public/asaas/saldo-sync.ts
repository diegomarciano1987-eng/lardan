import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * 0299 — a cada minuto: baixa feita no Lardan (manual, OFX, outra conta) ou título cancelado
 * cancela a cobrança antiga no Asaas e, havendo saldo, cria outra pelo saldo exato.
 * 0306: no mesmo minuto, o cadastro alterado no Lardan (celular, e-mail, endereço, nome) é espelhado no Asaas.
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
          // 0306: cadastro da cliente no Lardan → Asaas (falha aqui nunca derruba o espelho de saldo)
          let clientes: Record<string, unknown> = {};
          try {
            const { espelharClientesProducao } = await import("@/lib/asaas/cliente-espelho.server");
            const c = await espelharClientesProducao({ limite: 15 });
            clientes = { processadas: c.processadas, atualizadas: c.atualizadas, iguais: c.iguais, diferentes: c.diferentes, erros: c.erros };
          } catch (e) {
            clientes = { erro: (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 200) };
          }
          return Response.json({ ok: true, ...r, clientes });
        } catch (e) {
          const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
          return Response.json({ ok: false, erro: msg }, { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * 0285 — de hora em hora: traz do Asaas as movimentações do extrato dos últimos 3 dias que ainda não
 * estão no sistema (mesma rotina oficial de extratos, em nome do responsável técnico da cobrança).
 * Só leitura no Asaas; as linhas de recebimento com baixa já feita se conciliam sozinhas.
 */
export const Route = createFileRoute("/api/public/asaas/extrato-hora")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const inicio = Date.now();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin.from("consultora_cobranca_config" as never).select("ator_user_id").limit(1).maybeSingle();
        const ator = (cfg as { ator_user_id: string } | null)?.ator_user_id;
        if (!ator) return Response.json({ ok: false, erro: "Sem responsável técnico configurado" }, { status: 500 });
        const { data: conta } = await supabaseAdmin
          .from("asaas_accounts" as never)
          .select("financial_account_id")
          .eq("environment" as never, "producao" as never)
          .eq("is_active" as never, true as never)
          .not("financial_account_id" as never, "is", null)
          .limit(1)
          .maybeSingle();
        const destino = (conta as { financial_account_id: string } | null)?.financial_account_id;
        if (!destino) return Response.json({ ok: false, erro: "Conta Asaas sem conta financeira ligada" }, { status: 500 });
        const de = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 3 * 86_400_000));
        const auditar = async (r: Record<string, unknown>) => {
          await supabaseAdmin.from("audit_logs").insert({
            actor_id: ator,
            action: "asaas.extrato.sync",
            entity: "financial_accounts",
            entity_id: destino,
            payload: { modo: "hora", de, ...r, ms: Date.now() - inicio } as never,
          });
        };
        try {
          const { executarSync } = await import("@/lib/asaas/extrato-sync.server");
          const r = await executarSync({ de, financial_account_id: destino }, { userId: ator, supabase: supabaseAdmin, servico: true });
          await auditar(r);
          return Response.json({ ok: true, ...r });
        } catch (e) {
          const msg = (e as Error).message.replace(/\$aact_[A-Za-z0-9_]+/g, "[oculto]").slice(0, 300);
          await auditar({ total: 0, novas: 0, erro: msg });
          return Response.json({ ok: false, erro: msg }, { status: 500 });
        }
      },
    },
  },
});

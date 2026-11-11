import { createFileRoute } from "@tanstack/react-router";

/** Rotina da manhã (agendada no banco): espelha cobranças Asaas, concilia e baixa recebidas. */
export const Route = createFileRoute("/api/public/asaas/sync-matinal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const esperado = process.env["ASAAS_SYNC_CRON_TOKEN"];
        const tok = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
        if (!esperado) return new Response("Server configuration error", { status: 500 });
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const h = (v: string) => createHash("sha256").update(v).digest();
        if (!tok || !timingSafeEqual(h(tok), h(esperado))) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await supabaseAdmin.from("consultora_cobranca_config" as never).select("ator_user_id").limit(1).maybeSingle();
        const actor = (cfg as { ator_user_id: string } | null)?.ator_user_id;
        if (!actor) return new Response("Sem responsável técnico configurado", { status: 500 });
        const agoraSP = new Date(Date.now() - 3 * 3600_000);
        const hoje = agoraSP.toISOString().slice(0, 10);
        const inicio = new Date(agoraSP.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
        // Domingo: conferência completa (sem teto); demais dias: só a janela dos últimos 45 dias.
        const modo = agoraSP.getUTCDay() === 0 ? "completo" : "diario";
        try {
          const { executarSyncAsaas } = await import("@/lib/asaas/espelho.server");
          const r = await executarSyncAsaas({ actor, de: modo === "completo" ? "2020-01-01" : inicio, ate: hoje, ignorarIntervalo: true, modo });
          // 0282: avisos que chegaram antes da cobrança existir no espelho são processados agora.
          let fila: unknown;
          try {
            const { drenarFilaAsaas } = await import("@/lib/asaas/fila.server");
            fila = await drenarFilaAsaas(supabaseAdmin as never);
          } catch (e) { fila = { erro: (e as Error).message }; }
          // Acordos sem 1º pagamento até venc. + 5 dias: cancela no Asaas e avisa quem fez o acordo.
          let acordos: unknown;
          try {
            const { encerrarAcordosVencidos } = await import("@/lib/asaas/cancelar.server");
            acordos = await encerrarAcordosVencidos(actor);
          } catch (e) { acordos = { erro: (e as Error).message }; }
          // Correios: rastreio das maletas em trânsito (30 dias contam da entrega) e voltas.
          let correios: unknown;
          try {
            const { atualizarRastros } = await import("@/lib/correios/correios.functions");
            correios = await atualizarRastros();
            const { atualizarRastrosTrocas } = await import("@/lib/correios/troca.functions");
            correios = { maletas: correios, trocas: await atualizarRastrosTrocas() };
          } catch (e) { correios = { erro: (e as Error).message }; }
          return Response.json({ ok: true, ...r, fila_avisos: fila, acordos_vencidos: acordos, correios });
        } catch (e) {
          return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});

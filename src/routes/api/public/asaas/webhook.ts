/**
 * Webhook do Asaas — único endereço de recebimento de eventos do provedor.
 *
 * POST /api/public/asaas/webhook
 *   Cabeçalho: asaas-access-token: <token configurado no Asaas>
 *   Corpo:     { event, dateCreated?, payment: { id, ... } }
 *
 * Fluxo: autentica pelo token da conta ativa → registra o evento antes de
 * qualquer efeito (dedupe por conteúdo) → processa (espelha situação).
 * Repetido não repete efeito. Nenhuma baixa financeira nasce aqui: a baixa
 * segue pela rotina humana existente na tela de recebíveis.
 */
import { createFileRoute } from "@tanstack/react-router";

const TAMANHO_MAXIMO = 256 * 1024;

export const Route = createFileRoute("/api/public/asaas/webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204 }),

      POST: async ({ request }) => {
        const { createHash, timingSafeEqual } = await import("node:crypto");
        const { registrarEvento } = await import("@/lib/asaas/eventos");
        const { bancoExecutor } = await import("@/lib/asaas/servidor.server");
        const { ROTINAS } = await import("@/lib/asaas/banco");
        const { paraCentavos } = await import("@/lib/asaas/transporte-http.server");

        /** Dinheiro do provedor vem em reais; payload interno é em centavos. */
        const cent = (v: unknown): number | undefined => {
          try {
            return paraCentavos(v) ?? undefined;
          } catch {
            return undefined;
          }
        };
        const txt = (v: unknown): string => (typeof v === "string" && v !== "" ? v : "");
        const mesmoToken = (recebido: string, esperado: string | undefined): boolean => {
          if (!esperado || esperado.length === 0) return false;
          const a = Buffer.from(recebido, "utf8");
          const b = Buffer.from(esperado, "utf8");
          return a.length === b.length && timingSafeEqual(a, b);
        };

        const bruto = await request.text();
        if (bruto.length > TAMANHO_MAXIMO) return new Response("Payload grande demais.", { status: 413 });

        let corpo: Record<string, unknown>;
        try {
          corpo = JSON.parse(bruto);
        } catch {
          return new Response("Payload inválido.", { status: 400 });
        }

        // ---- identifica a conta ativa conectada e autentica a entrega ----
        let conta: { id: string; webhook_secret_ref: string | null } | undefined;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("asaas_accounts")
            .select("id, webhook_secret_ref")
            .eq("is_active", true)
            .eq("modo_execucao", "conectado")
            .not("webhook_secret_ref", "is", null)
            .limit(2);
          if (error) throw new Error(error.message);
          if (data && data.length === 1) conta = data[0];
        } catch {
          return new Response("Indisponível.", { status: 503 });
        }
        if (!conta) return new Response("Conta não identificada.", { status: 202 });
        if (!mesmoToken(request.headers.get("asaas-access-token") ?? "", process.env[conta.webhook_secret_ref!])) {
          return new Response("Entrega não autenticada.", { status: 401 });
        }

        // ---- estrutura mínima ----
        const evento = txt(corpo["event"]);
        const pagamento = (corpo["payment"] ?? null) as Record<string, unknown> | null;
        if (!evento || !pagamento || !txt(pagamento["id"])) {
          return Response.json({ received: true, ignored: "sem_evento_ou_cobranca" });
        }

        const payload = {
          valuePaidCents: cent(pagamento["valuePaid"] ?? pagamento["value"]),
          feeCents: cent(pagamento["fee"]),
          netValueCents: cent(pagamento["netValue"]),
          refundedCents: cent(pagamento["refundedValue"] ?? pagamento["refundAmount"]),
          paymentDate: txt(pagamento["paymentDate"]) || txt(pagamento["clientPaymentDate"]),
          creditDate: txt(pagamento["creditDate"]),
          original: corpo,
        };
        // identidade = ID oficial do evento no Asaas (por conta); hash só como evidência
        const hash = createHash("sha256").update(bruto).digest("hex");
        const idOficial = txt(corpo["id"]);
        const externalId = idOficial || `wh:${evento}:${txt(pagamento["id"])}:${hash.slice(0, 16)}`;

        try {
          const executor = await bancoExecutor();
          const reg = (await registrarEvento(
            executor,
            conta.id,
            {
              id: externalId,
              event: evento,
              chargeExternalId: txt(pagamento["id"]),
              eventAt: txt(corpo["dateCreated"]) || new Date().toISOString(),
              payload: { ...payload, sha256: hash },
            },
            "provedor",
          )) as { id: string; novo?: boolean; pendente?: boolean };
          let processado: unknown = null;
          // novo OU salvo e ainda pendente: termina o trabalho; concluído não repete efeito
          if (reg.novo !== false || reg.pendente === true) {
            processado = await executor.rpc(ROTINAS.eventoProcessar, { _evento: reg.id });
          }
          return Response.json({ received: true, novo: reg.novo !== false, resultado: processado });
        } catch (e) {
          // erro aqui devolve 5xx e o Asaas reenvia; dedupe protege contra efeito duplo
          return new Response(`Falha ao registrar evento: ${e instanceof Error ? e.message : "desconhecida"}`, { status: 500 });
        }
      },
    },
  },
});
